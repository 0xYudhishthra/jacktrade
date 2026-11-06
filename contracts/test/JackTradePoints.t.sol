// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {JackTradePoints} from "../src/JackTradePoints.sol";
import {WithVm} from "../lib/Vm.sol";

contract JackTradePointsTest is WithVm {
    address constant SYNCER = address(0x5111C);
    address constant ALICE = address(0xA11CE);
    address constant BOB = address(0xB0B);
    address constant MALLORY = address(0xBAD);

    uint256 constant USD = 1e6; // USDG raw units per dollar
    uint256 constant PTS = 1e18; // point units per point

    JackTradePoints points;

    function setUp() public {
        points = new JackTradePoints(SYNCER);
    }

    // ---------------------------------------------------------------- helpers

    function _sync1(address user, uint256 cumulative) internal {
        address[] memory users = new address[](1);
        uint256[] memory notional = new uint256[](1);
        users[0] = user;
        notional[0] = cumulative;
        vm.prank(SYNCER);
        points.sync(users, notional);
    }

    // ---------------------------------------------------------------- metadata

    function test_metadata() public view {
        require(keccak256(bytes(points.name())) == keccak256("JackTrade Points"), "name");
        require(keccak256(bytes(points.symbol())) == keccak256("JTP"), "symbol");
        require(points.decimals() == 18, "decimals");
        require(points.POINTS_PER_100_USD() == 10, "rate");
        require(points.totalSupply() == 0, "supply");
        require(points.owner() == address(this), "owner");
        require(points.syncer() == SYNCER, "syncer");
        require(points.pendingOwner() == address(0), "pending");
    }

    function test_constructor_revertsOnZeroSyncer() public {
        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.ZeroAddress.selector));
        new JackTradePoints(address(0));
    }

    // ---------------------------------------------------------------- award math

    function test_pointsForNotional() public view {
        require(points.pointsForNotional(0) == 0, "zero");
        require(points.pointsForNotional(1) == 1e11, "1 raw unit");
        require(points.pointsForNotional(100 * USD) == 10 * PTS, "$100 -> 10");
        require(points.pointsForNotional(1_000 * USD) == 100 * PTS, "$1,000 -> 100");
        // $10 min margin at 1000x = $10,000 notional -> 1,000 points
        require(points.pointsForNotional(10_000 * USD) == 1_000 * PTS, "$10,000 -> 1,000");
        // $20 at 50x = $1,000 notional -> 100 points
        require(points.pointsForNotional(20 * USD * 50) == 100 * PTS, "$20 x 50");
    }

    function test_sync_awards100PointsFor1000Usd() public {
        _sync1(ALICE, 1_000 * USD);
        require(points.balanceOf(ALICE) == 100e18, "balance");
        require(points.totalSupply() == 100e18, "supply");
        require(points.notionalSynced(ALICE) == 1_000 * USD, "synced");
    }

    function test_sync_emitsTransferAndPointsSynced() public {
        address[] memory users = new address[](1);
        uint256[] memory notional = new uint256[](1);
        users[0] = ALICE;
        notional[0] = 1_000 * USD;

        vm.expectEmit(true, true, false, true);
        emit JackTradePoints.Transfer(address(0), ALICE, 100 * PTS);
        vm.expectEmit(true, false, false, true);
        emit JackTradePoints.PointsSynced(ALICE, 1_000 * USD, 100 * PTS);

        vm.prank(SYNCER);
        points.sync(users, notional);
    }

    function test_sync_idempotent() public {
        _sync1(ALICE, 1_000 * USD);
        _sync1(ALICE, 1_000 * USD);
        _sync1(ALICE, 1_000 * USD);
        require(points.balanceOf(ALICE) == 100 * PTS, "balance");
        require(points.totalSupply() == 100 * PTS, "supply");
        require(points.notionalSynced(ALICE) == 1_000 * USD, "synced");
    }

    function test_sync_partialIncrease() public {
        _sync1(ALICE, 1_000 * USD);
        _sync1(ALICE, 1_500 * USD);
        require(points.balanceOf(ALICE) == 150 * PTS, "balance");
        require(points.totalSupply() == 150 * PTS, "supply");
        require(points.notionalSynced(ALICE) == 1_500 * USD, "synced");
    }

    function test_sync_partialIncreaseEmitsDeltaOnly() public {
        _sync1(ALICE, 1_000 * USD);

        vm.expectEmit(true, true, false, true);
        emit JackTradePoints.Transfer(address(0), ALICE, 50 * PTS);
        vm.expectEmit(true, false, false, true);
        emit JackTradePoints.PointsSynced(ALICE, 500 * USD, 50 * PTS);
        _sync1(ALICE, 1_500 * USD);
    }

    function test_sync_ignoresDecrease() public {
        _sync1(ALICE, 1_500 * USD);
        _sync1(ALICE, 1_000 * USD);
        require(points.balanceOf(ALICE) == 150 * PTS, "balance unchanged");
        require(points.notionalSynced(ALICE) == 1_500 * USD, "synced never decreases");

        // Next increase credits only above the high-water mark.
        _sync1(ALICE, 2_000 * USD);
        require(points.balanceOf(ALICE) == 200 * PTS, "balance after increase");
        require(points.totalSupply() == 200 * PTS, "supply");
    }

    function test_sync_batchWithDuplicatesAndSkips() public {
        _sync1(BOB, 500 * USD);

        address[] memory users = new address[](4);
        uint256[] memory notional = new uint256[](4);
        users[0] = ALICE;
        notional[0] = 1_000 * USD; // +100
        users[1] = BOB;
        notional[1] = 400 * USD; // lower: skipped
        users[2] = ALICE;
        notional[2] = 1_200 * USD; // +20
        users[3] = ALICE;
        notional[3] = 1_100 * USD; // lower: skipped

        vm.prank(SYNCER);
        points.sync(users, notional);

        require(points.balanceOf(ALICE) == 120 * PTS, "alice");
        require(points.notionalSynced(ALICE) == 1_200 * USD, "alice synced");
        require(points.balanceOf(BOB) == 50 * PTS, "bob");
        require(points.notionalSynced(BOB) == 500 * USD, "bob synced");
        require(points.totalSupply() == 170 * PTS, "supply");
    }

    function test_sync_emptyBatch() public {
        vm.prank(SYNCER);
        points.sync(new address[](0), new uint256[](0));
        require(points.totalSupply() == 0, "supply");
    }

    function testFuzz_sync_balanceTracksHighWaterMark(uint128 a, uint128 b) public {
        _sync1(ALICE, a);
        _sync1(ALICE, b);
        uint256 high = a > b ? a : b;
        require(points.notionalSynced(ALICE) == high, "synced");
        require(points.balanceOf(ALICE) == uint256(high) * 1e11, "balance");
        require(points.totalSupply() == points.balanceOf(ALICE), "supply");
    }

    // ---------------------------------------------------------------- sync access + input checks

    function test_sync_onlySyncer() public {
        address[] memory users = new address[](1);
        uint256[] memory notional = new uint256[](1);
        users[0] = ALICE;
        notional[0] = 1_000 * USD;

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotSyncer.selector, MALLORY));
        vm.prank(MALLORY);
        points.sync(users, notional);

        // The owner is not the syncer either.
        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotSyncer.selector, address(this)));
        points.sync(users, notional);
    }

    function test_sync_revertsOnLengthMismatch() public {
        address[] memory users = new address[](2);
        uint256[] memory notional = new uint256[](1);
        users[0] = ALICE;
        users[1] = BOB;
        notional[0] = 1_000 * USD;

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.LengthMismatch.selector, 2, 1));
        vm.prank(SYNCER);
        points.sync(users, notional);
    }

    function test_sync_revertsOnZeroAddressUser() public {
        address[] memory users = new address[](1);
        uint256[] memory notional = new uint256[](1);
        notional[0] = 1_000 * USD;

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.ZeroAddress.selector));
        vm.prank(SYNCER);
        points.sync(users, notional);
    }

    // ---------------------------------------------------------------- non-transferable

    function test_transfersRevert() public {
        _sync1(ALICE, 1_000 * USD);

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NonTransferable.selector));
        vm.prank(ALICE);
        points.transfer(BOB, 1);

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NonTransferable.selector));
        vm.prank(ALICE);
        points.approve(BOB, 1);

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NonTransferable.selector));
        vm.prank(BOB);
        points.transferFrom(ALICE, BOB, 1);

        require(points.allowance(ALICE, BOB) == 0, "allowance");
        require(points.balanceOf(ALICE) == 100 * PTS, "alice unchanged");
        require(points.balanceOf(BOB) == 0, "bob unchanged");
    }

    // ---------------------------------------------------------------- admin

    function test_setSyncer() public {
        address newSyncer = address(0x5222);

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotOwner.selector, MALLORY));
        vm.prank(MALLORY);
        points.setSyncer(MALLORY);

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.ZeroAddress.selector));
        points.setSyncer(address(0));

        vm.expectEmit(true, true, false, false);
        emit JackTradePoints.SyncerUpdated(SYNCER, newSyncer);
        points.setSyncer(newSyncer);
        require(points.syncer() == newSyncer, "syncer");

        // Old syncer loses access; new syncer can sync.
        address[] memory users = new address[](1);
        uint256[] memory notional = new uint256[](1);
        users[0] = ALICE;
        notional[0] = 1_000 * USD;

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotSyncer.selector, SYNCER));
        vm.prank(SYNCER);
        points.sync(users, notional);

        vm.prank(newSyncer);
        points.sync(users, notional);
        require(points.balanceOf(ALICE) == 100 * PTS, "new syncer works");
    }

    function test_ownership_twoStep() public {
        address newOwner = address(0x0E1);

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotOwner.selector, MALLORY));
        vm.prank(MALLORY);
        points.transferOwnership(MALLORY);

        vm.expectEmit(true, true, false, false);
        emit JackTradePoints.OwnershipTransferStarted(address(this), newOwner);
        points.transferOwnership(newOwner);
        require(points.pendingOwner() == newOwner, "pending");
        require(points.owner() == address(this), "owner unchanged until accept");

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotPendingOwner.selector, MALLORY));
        vm.prank(MALLORY);
        points.acceptOwnership();

        vm.expectEmit(true, true, false, false);
        emit JackTradePoints.OwnershipTransferred(address(this), newOwner);
        vm.prank(newOwner);
        points.acceptOwnership();
        require(points.owner() == newOwner, "owner");
        require(points.pendingOwner() == address(0), "pending cleared");

        // Old owner is locked out; new owner can admin.
        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotOwner.selector, address(this)));
        points.setSyncer(address(0x5333));

        vm.prank(newOwner);
        points.setSyncer(address(0x5333));
        require(points.syncer() == address(0x5333), "new owner setSyncer");
    }

    function test_ownership_cancelPending() public {
        points.transferOwnership(BOB);
        points.transferOwnership(address(0));
        require(points.pendingOwner() == address(0), "cancelled");

        vm.expectRevert(abi.encodeWithSelector(JackTradePoints.NotPendingOwner.selector, BOB));
        vm.prank(BOB);
        points.acceptOwnership();
    }
}
