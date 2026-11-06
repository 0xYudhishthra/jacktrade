// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @dev The few Foundry cheatcodes used here, so the project needs no forge-std dependency.
interface Vm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

abstract contract WithVm {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
