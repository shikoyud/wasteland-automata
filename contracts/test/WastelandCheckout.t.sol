// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {WastelandCheckout} from "../src/WastelandCheckout.sol";

contract RejectingTreasury {
    receive() external payable {
        revert("no");
    }
}

contract WastelandCheckoutTest is Test {
    event OrderPaid(bytes32 indexed orderId, address indexed payer, uint256 amount);

    WastelandCheckout internal checkout;
    address internal safe = makeAddr("safe");
    address payable internal treasury = payable(makeAddr("treasury"));
    uint256 internal signerKey = 0xA11CE;
    address internal signer;
    address internal player = makeAddr("player");

    bytes32 internal constant ORDER = keccak256("pr_5:1");
    uint256 internal constant AMOUNT = 1_663_333_333_333_333; // $4.99 at $3,000/ETH
    uint64 internal expiresAt;

    function setUp() public {
        signer = vm.addr(signerKey);
        checkout = new WastelandCheckout(safe, signer, treasury);
        expiresAt = uint64(block.timestamp + 30 minutes);
        vm.deal(player, 10 ether);
    }

    function _sign(uint256 key, bytes32 orderId, address payer, uint256 amount, uint64 exp)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, checkout.quoteDigest(orderId, payer, amount, exp));
        return abi.encodePacked(r, s, v);
    }

    function test_PaysAndForwardsToTreasury() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.expectEmit(true, true, false, true, address(checkout));
        emit OrderPaid(ORDER, player, AMOUNT);
        vm.prank(player);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
        assertTrue(checkout.paid(ORDER));
        assertEq(treasury.balance, AMOUNT);
        assertEq(address(checkout).balance, 0);
    }

    function test_RevertWhen_PaidTwice() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.startPrank(player);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
        vm.expectRevert(WastelandCheckout.AlreadyPaid.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
        vm.stopPrank();
    }

    function test_RevertWhen_WrongAmount() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.BadSignature.selector);
        checkout.pay{value: AMOUNT - 1}(ORDER, expiresAt, sig);
    }

    function test_RevertWhen_WrongPayer() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        address other = makeAddr("other");
        vm.deal(other, 1 ether);
        vm.prank(other);
        vm.expectRevert(WastelandCheckout.BadSignature.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
    }

    function test_RevertWhen_WrongSigner() public {
        bytes memory sig = _sign(0xB0B, ORDER, player, AMOUNT, expiresAt);
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.BadSignature.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
    }

    function test_RevertWhen_Expired() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.warp(uint256(expiresAt) + 1);
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.QuoteExpired.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
    }

    function test_RevertWhen_ExpiryEditedByPayer() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.BadSignature.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt + 1 days, sig);
    }

    function test_RevertWhen_HighS() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, checkout.quoteDigest(ORDER, player, AMOUNT, expiresAt));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleated = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.BadSignature.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, malleated);
    }

    function test_RevertWhen_Paused() public {
        vm.prank(safe);
        checkout.setPaused(true);
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.Paused.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
    }

    function test_RevertWhen_TreasuryRejects() public {
        RejectingTreasury bad = new RejectingTreasury();
        vm.prank(safe);
        checkout.setTreasury(payable(address(bad)));
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.TransferFailed.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
        assertFalse(checkout.paid(ORDER));
    }

    function test_RevertWhen_DirectTransfer() public {
        vm.prank(player);
        (bool ok,) = address(checkout).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_OnlyOwnerAdmin() public {
        vm.expectRevert(WastelandCheckout.NotOwner.selector);
        checkout.setQuoteSigner(address(1));
        vm.expectRevert(WastelandCheckout.NotOwner.selector);
        checkout.setTreasury(payable(address(1)));
        vm.expectRevert(WastelandCheckout.NotOwner.selector);
        checkout.setPaused(true);
    }

    function test_SignerRotationInvalidatesOldQuotes() public {
        bytes memory sig = _sign(signerKey, ORDER, player, AMOUNT, expiresAt);
        vm.prank(safe);
        checkout.setQuoteSigner(vm.addr(0xC0FFEE));
        vm.prank(player);
        vm.expectRevert(WastelandCheckout.BadSignature.selector);
        checkout.pay{value: AMOUNT}(ORDER, expiresAt, sig);
    }

    function test_TwoStepOwnership() public {
        address next = makeAddr("nextSafe");
        vm.prank(safe);
        checkout.transferOwnership(next);
        assertEq(checkout.owner(), safe);
        vm.expectRevert(WastelandCheckout.NotPendingOwner.selector);
        checkout.acceptOwnership();
        vm.prank(next);
        checkout.acceptOwnership();
        assertEq(checkout.owner(), next);
    }

    function testFuzz_ValidQuotePays(bytes32 orderId, uint96 amount, uint32 ttl) public {
        vm.assume(amount > 0 && amount <= 10 ether);
        uint64 exp = uint64(block.timestamp) + uint64(ttl);
        bytes memory sig = _sign(signerKey, orderId, player, amount, exp);
        vm.prank(player);
        checkout.pay{value: amount}(orderId, exp, sig);
        assertTrue(checkout.paid(orderId));
        assertEq(treasury.balance, amount);
    }
}
