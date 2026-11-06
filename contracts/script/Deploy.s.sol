// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {JackTradePoints} from "../src/JackTradePoints.sol";
import {WithVm} from "../lib/Vm.sol";

/// @notice Deploys JackTradePoints to Robinhood Chain mainnet (chain id 4663).
/// @dev Reads DEPLOYER_PRIVATE_KEY from contracts/.env (forge loads it automatically).
///      SYNCER defaults to the deployer.
///
///   forge script script/Deploy.s.sol:Deploy --rpc-url robinhood --broadcast
contract Deploy is WithVm {
    function run() external returns (JackTradePoints points, address deployer, address syncer) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(pk);
        syncer = vm.envOr("SYNCER", deployer);

        vm.startBroadcast(pk);
        points = new JackTradePoints(syncer);
        vm.stopBroadcast();
    }
}
