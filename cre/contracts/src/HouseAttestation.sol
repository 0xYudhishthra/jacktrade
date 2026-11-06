// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev ERC-165 interface detection (the KeystoneForwarder checks this before delivering).
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @dev Chainlink CRE receiver interface (called by the KeystoneForwarder).
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title HouseAttestation ("Proof of House")
/// @notice Stores the latest attestation of the JackTrade Exchange (Robinhood Chain) written by a
///         Chainlink CRE workflow: LP bankroll, payout queue, open interest and open positions.
///         All USD amounts use 6 decimals (USDG).
contract HouseAttestation is IReceiver {
    struct Attestation {
        uint256 bankroll; // lpBankrollAvailable(), 6 decimals
        uint256 queued; // totalQueued(), 6 decimals
        uint256 openInterest; // sum of long + short OI across markets, 6 decimals
        uint256 positions; // number of open positions
        uint64 observedAt; // unix seconds (DON time)
    }

    address public immutable owner;
    address public forwarder;
    Attestation private latestReport;

    event HouseAttested(
        uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions, uint64 observedAt
    );
    event ForwarderUpdated(address indexed previous, address indexed current);

    error NotForwarder(address caller);
    error NotOwner(address caller);
    error StaleReport(uint64 observedAt, uint64 latestObservedAt);

    constructor(address _forwarder) {
        owner = msg.sender;
        forwarder = _forwarder;
        emit ForwarderUpdated(address(0), _forwarder);
    }

    /// @inheritdoc IReceiver
    /// @dev `metadata` (workflow id / name / owner) is not checked: the simulation MockKeystoneForwarder
    ///      does not provide it. Only the configured forwarder may call.
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);

        (uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions, uint64 observedAt) =
            abi.decode(report, (uint256, uint256, uint256, uint256, uint64));

        uint64 last = latestReport.observedAt;
        if (observedAt <= last) revert StaleReport(observedAt, last);

        latestReport = Attestation(bankroll, queued, openInterest, positions, observedAt);
        emit HouseAttested(bankroll, queued, openInterest, positions, observedAt);
    }

    /// @notice Latest attestation (all zeros before the first report).
    function latest()
        external
        view
        returns (uint256 bankroll, uint256 queued, uint256 openInterest, uint256 positions, uint64 observedAt)
    {
        Attestation memory a = latestReport;
        return (a.bankroll, a.queued, a.openInterest, a.positions, a.observedAt);
    }

    /// @notice Switch forwarder, e.g. from the simulation MockKeystoneForwarder to the production KeystoneForwarder.
    function setForwarder(address _forwarder) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        emit ForwarderUpdated(forwarder, _forwarder);
        forwarder = _forwarder;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
