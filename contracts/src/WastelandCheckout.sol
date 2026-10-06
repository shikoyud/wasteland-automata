// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title WastelandCheckout
/// @notice Accepts ETH payments for cosmetic items, against quotes signed by the game server.
///         Holds no funds: every payment is forwarded to the treasury in the same transaction.
///         Not upgradeable. The chain watcher reads `OrderPaid` and grants the entitlement off-chain.
/// @dev    Sketch for review and audit. Target: Robinhood Chain (Arbitrum stack; mainnet 4663, testnet 46630).
///         Owner and treasury: one hardware wallet (move to a Safe if one is deployed on the chain).
///         Quote signer: a server key that can only approve payments to the treasury; rotate with setQuoteSigner.
///         Uses block.timestamp only (on Arbitrum chains block.number is an L1 estimate). Compile for the Paris EVM
///         version until a testnet deploy confirms Cancun opcodes.
contract WastelandCheckout {
    // keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
    bytes32 private constant DOMAIN_TYPEHASH = 0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f;
    bytes32 public constant QUOTE_TYPEHASH =
        keccak256("Quote(bytes32 orderId,address payer,uint256 amount,uint64 expiresAt)");
    bytes32 private constant NAME_HASH = keccak256("WastelandCheckout");
    bytes32 private constant VERSION_HASH = keccak256("1");
    // secp256k1n / 2, the upper bound for a non-malleable `s` (EIP-2)
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    uint256 private immutable _cachedChainId;
    bytes32 private immutable _cachedDomainSeparator;

    address public owner;
    address public pendingOwner;
    address public quoteSigner;
    address payable public treasury;
    bool public paused;

    /// @notice orderId => paid. An order can be paid exactly once.
    mapping(bytes32 => bool) public paid;

    event OrderPaid(bytes32 indexed orderId, address indexed payer, uint256 amount);
    event QuoteSignerChanged(address indexed signer);
    event TreasuryChanged(address indexed treasury);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error Paused();
    error QuoteExpired();
    error AlreadyPaid();
    error BadSignature();
    error ZeroAmount();
    error TransferFailed();
    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error DirectPaymentRejected();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, address quoteSigner_, address payable treasury_) {
        if (owner_ == address(0) || quoteSigner_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        owner = owner_;
        quoteSigner = quoteSigner_;
        treasury = treasury_;
        _cachedChainId = block.chainid;
        _cachedDomainSeparator = _buildDomainSeparator();
        emit OwnershipTransferred(address(0), owner_);
        emit QuoteSignerChanged(quoteSigner_);
        emit TreasuryChanged(treasury_);
    }

    /// @notice Pay for an order. `msg.sender` must be the quoted payer and `msg.value` the quoted amount,
    ///         because both are part of the signed digest.
    function pay(bytes32 orderId, uint64 expiresAt, bytes calldata signature) external payable {
        if (paused) revert Paused();
        if (block.timestamp > expiresAt) revert QuoteExpired();
        if (msg.value == 0) revert ZeroAmount();
        if (paid[orderId]) revert AlreadyPaid();
        if (_recover(quoteDigest(orderId, msg.sender, msg.value, expiresAt), signature) != quoteSigner) {
            revert BadSignature();
        }

        paid[orderId] = true;
        emit OrderPaid(orderId, msg.sender, msg.value);

        (bool ok,) = treasury.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice The EIP-712 digest the server signs. Exposed so the dashboard and tests can check a quote.
    function quoteDigest(bytes32 orderId, address payer, uint256 amount, uint64 expiresAt)
        public
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(QUOTE_TYPEHASH, orderId, payer, amount, expiresAt));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function domainSeparator() public view returns (bytes32) {
        return block.chainid == _cachedChainId ? _cachedDomainSeparator : _buildDomainSeparator();
    }

    // ---- admin (the owner wallet) ----

    function setQuoteSigner(address signer) external onlyOwner {
        if (signer == address(0)) revert ZeroAddress();
        quoteSigner = signer;
        emit QuoteSignerChanged(signer);
    }

    function setTreasury(address payable treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Plain ETH transfers are refused, so a payment can never arrive without an orderId.
    receive() external payable {
        revert DirectPaymentRejected();
    }

    // ---- internal ----

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
        return signer;
    }
}
