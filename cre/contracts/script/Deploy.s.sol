// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HouseAttestation} from "../src/HouseAttestation.sol";
import {WithVm} from "../lib/Vm.sol";

/// forge script script/Deploy.s.sol --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
///   --private-key $CRE_ETH_PRIVATE_KEY --broadcast
/// FORWARDER defaults to the Ethereum Sepolia MockKeystoneForwarder used by `cre workflow simulate`.
contract Deploy is WithVm {
    address constant SEPOLIA_MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external returns (HouseAttestation house) {
        address forwarder = vm.envOr("FORWARDER", SEPOLIA_MOCK_FORWARDER);
        vm.startBroadcast();
        house = new HouseAttestation(forwarder);
        vm.stopBroadcast();
    }
}
