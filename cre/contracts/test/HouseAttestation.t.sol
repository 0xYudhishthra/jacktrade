// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {HouseAttestation, IReceiver, IERC165} from "../src/HouseAttestation.sol";
import {WithVm} from "../lib/Vm.sol";

contract HouseAttestationTest is WithVm {
    address constant FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88; // Sepolia MockKeystoneForwarder
    HouseAttestation house;

    function setUp() public {
        house = new HouseAttestation(FORWARDER);
    }

    // Same layout the workflow encodes: (uint256,uint256,uint256,uint256,uint64)
    function _report(uint256 b, uint256 q, uint256 oi, uint256 p, uint64 t) internal pure returns (bytes memory) {
        return abi.encode(b, q, oi, p, t);
    }

    function test_onReport_storesLatest() public {
        vm.prank(FORWARDER);
        house.onReport("", _report(43_400_413, 1_000_000, 250_000_000_000, 7, 1_762_400_000));

        (uint256 b, uint256 q, uint256 oi, uint256 p, uint64 t) = house.latest();
        require(b == 43_400_413, "bankroll");
        require(q == 1_000_000, "queued");
        require(oi == 250_000_000_000, "openInterest");
        require(p == 7, "positions");
        require(t == 1_762_400_000, "observedAt");
    }

    function test_onReport_revertsForNonForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(HouseAttestation.NotForwarder.selector, address(this)));
        house.onReport("", _report(1, 2, 3, 4, 5));
    }

    function test_onReport_revertsOnStaleReport() public {
        vm.prank(FORWARDER);
        house.onReport("", _report(1, 0, 0, 0, 100));
        vm.expectRevert(abi.encodeWithSelector(HouseAttestation.StaleReport.selector, uint64(100), uint64(100)));
        vm.prank(FORWARDER);
        house.onReport("", _report(2, 0, 0, 0, 100));
    }

    function test_setForwarder_onlyOwner() public {
        address prod = 0xF8344CFd5c43616a4366C34E3EEE75af79a74482; // Sepolia KeystoneForwarder
        house.setForwarder(prod);
        require(house.forwarder() == prod, "forwarder");

        vm.expectRevert(abi.encodeWithSelector(HouseAttestation.NotOwner.selector, address(0xBEEF)));
        vm.prank(address(0xBEEF));
        house.setForwarder(address(0xBEEF));
    }

    function test_supportsInterface() public view {
        require(house.supportsInterface(type(IReceiver).interfaceId), "IReceiver");
        require(house.supportsInterface(type(IERC165).interfaceId), "IERC165");
        require(!house.supportsInterface(0xffffffff), "invalid id");
    }
}
