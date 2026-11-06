// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title JackTradePoints
/// @notice Onchain, non-transferable points ledger for JackTrade on Robinhood Chain.
/// @dev Rule: 10 points per $100 of notional traded (notional = margin x leverage), win or lose.
///      An off-chain syncer reads each trader's cumulative notional (USDG raw units, 6 decimals)
///      from the exchange indexer and pushes it here with `sync`. The contract credits only the
///      increase since the last sync, so re-syncing the same totals is a no-op.
///      Exposes ERC-20 read functions so wallets and explorers can display balances. Transfers and
///      approvals always revert. Awards emit `Transfer(address(0), user, amount)` like a mint.
contract JackTradePoints {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    /// @notice Points awarded per $100 of notional.
    uint256 public constant POINTS_PER_100_USD = 10;

    /// @dev Scales USDG raw units (6 decimals) up to point units (18 decimals).
    uint256 private constant USDG_TO_POINT_SCALE = 1e12;

    /// @notice Token name shown by wallets and explorers.
    string public constant name = "JackTrade Points";

    /// @notice Token symbol shown by wallets and explorers.
    string public constant symbol = "JTP";

    /// @notice Points use 18 decimals, so 100 points is 100e18.
    uint8 public constant decimals = 18;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Sum of all points awarded.
    uint256 public totalSupply;

    /// @notice Points held by each account.
    mapping(address => uint256) public balanceOf;

    /// @notice Cumulative notional (USDG raw units) already credited for each trader.
    mapping(address => uint256) public notionalSynced;

    /// @notice The only address allowed to call `sync`.
    address public syncer;

    /// @notice Contract owner. Can change the syncer and transfer ownership.
    address public owner;

    /// @notice Address nominated by `transferOwnership`; becomes owner after `acceptOwnership`.
    address public pendingOwner;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice ERC-20 Transfer event. Emitted only as a mint (`from == address(0)`) when points are awarded.
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @notice Emitted when a trader's cumulative notional increases and points are awarded.
    /// @param user The trader.
    /// @param deltaNotional Newly credited notional, USDG raw units (6 decimals).
    /// @param pointsAwarded Points minted for `deltaNotional` (18 decimals).
    event PointsSynced(address indexed user, uint256 deltaNotional, uint256 pointsAwarded);

    /// @notice Emitted when the syncer changes.
    event SyncerUpdated(address indexed previousSyncer, address indexed newSyncer);

    /// @notice Emitted when the owner nominates a new owner.
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    /// @notice Emitted when ownership changes.
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    /// @notice Caller is not the owner.
    error NotOwner(address caller);

    /// @notice Caller is not the pending owner.
    error NotPendingOwner(address caller);

    /// @notice Caller is not the syncer.
    error NotSyncer(address caller);

    /// @notice `users` and `cumulativeNotional` have different lengths.
    error LengthMismatch(uint256 usersLength, uint256 notionalLength);

    /// @notice Points cannot be transferred or approved.
    error NonTransferable();

    /// @notice A zero address was supplied where an account is required.
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param initialSyncer Address allowed to call `sync`. The deployer becomes the owner.
    constructor(address initialSyncer) {
        if (initialSyncer == address(0)) revert ZeroAddress();
        owner = msg.sender;
        syncer = initialSyncer;
        emit OwnershipTransferred(address(0), msg.sender);
        emit SyncerUpdated(address(0), initialSyncer);
    }

    // ---------------------------------------------------------------------
    // Points
    // ---------------------------------------------------------------------

    /// @notice Credits points for each trader's new notional since the last sync.
    /// @dev For each entry, if `cumulativeNotional[i] > notionalSynced[users[i]]`, awards points for the
    ///      difference and stores the new total. Equal or lower totals are skipped, so credited notional
    ///      never decreases and re-syncing is idempotent. Duplicate users in one batch are safe.
    /// @param users Traders to sync.
    /// @param cumulativeNotional Each trader's lifetime notional, USDG raw units (6 decimals).
    function sync(address[] calldata users, uint256[] calldata cumulativeNotional) external {
        if (msg.sender != syncer) revert NotSyncer(msg.sender);
        uint256 len = users.length;
        if (len != cumulativeNotional.length) revert LengthMismatch(len, cumulativeNotional.length);

        uint256 minted;
        for (uint256 i; i < len; ++i) {
            address user = users[i];
            if (user == address(0)) revert ZeroAddress();

            uint256 cumulative = cumulativeNotional[i];
            uint256 already = notionalSynced[user];
            if (cumulative <= already) continue;

            uint256 deltaNotional = cumulative - already;
            uint256 points = pointsForNotional(deltaNotional);

            notionalSynced[user] = cumulative;
            balanceOf[user] += points;
            minted += points;

            emit Transfer(address(0), user, points);
            emit PointsSynced(user, deltaNotional, points);
        }
        totalSupply += minted;
    }

    /// @notice Points earned for a given notional.
    /// @param notional Notional in USDG raw units (6 decimals).
    /// @return Points in 18-decimal units. Exact: 1 raw USDG unit = 1e11 point units.
    function pointsForNotional(uint256 notional) public pure returns (uint256) {
        return notional * USDG_TO_POINT_SCALE * POINTS_PER_100_USD / 100;
    }

    // ---------------------------------------------------------------------
    // ERC-20 compatibility (non-transferable)
    // ---------------------------------------------------------------------

    /// @notice Always 0: points cannot be approved.
    function allowance(address, address) external pure returns (uint256) {
        return 0;
    }

    /// @notice Always reverts: points are non-transferable.
    function transfer(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    /// @notice Always reverts: points are non-transferable.
    function transferFrom(address, address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    /// @notice Always reverts: points are non-transferable.
    function approve(address, uint256) external pure returns (bool) {
        revert NonTransferable();
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    /// @notice Changes the address allowed to call `sync`.
    /// @param newSyncer The new syncer. Must not be the zero address.
    function setSyncer(address newSyncer) external onlyOwner {
        if (newSyncer == address(0)) revert ZeroAddress();
        emit SyncerUpdated(syncer, newSyncer);
        syncer = newSyncer;
    }

    /// @notice Starts a two-step ownership transfer. Pass `address(0)` to cancel a pending transfer.
    /// @param newOwner The address that must call `acceptOwnership`.
    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Completes a two-step ownership transfer. Callable only by `pendingOwner`.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
