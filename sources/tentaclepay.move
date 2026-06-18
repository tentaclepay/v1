/// Module: tentaclepay
///
/// Tentacle Pay signs payment payloads through Ika 2PC-MPC dWallets.
/// The package custodies one `DWalletCap` per elliptic curve inside a shared
/// `Signer` object and exposes `sign`, which routes a message to the Ika
/// `DWalletCoordinator` for threshold signing under the chosen curve.
module tentaclepay::tentaclepay;

use ika::ika::IKA;
use ika_dwallet_2pc_mpc::coordinator::DWalletCoordinator;
use ika_dwallet_2pc_mpc::coordinator_inner::{DWalletCap, UnverifiedPresignCap};
use sui::balance::{Self, Balance};
use sui::coin::Coin;
use sui::ed25519;
use sui::event;
use sui::sui::SUI;
use usdc::usdc::USDC;

// === Constants ===

/// Length of an Ed25519 public key in bytes.
const ED25519_PUBKEY_LEN: u64 = 32;

// === Errors ===

/// The verifier's signature over the attested data did not validate against the
/// `verifier_pubkey` stored in `Protocol`.
const EInvalidVerifierSignature: u64 = 0;
/// The verifier public key supplied at protocol creation is not 32 bytes.
const EInvalidPublicKey: u64 = 1;

// === Structs ===

/// Capability granting administrative control over the `Signer`.
public struct AdminCap has key, store {
    id: UID,
}

/// Shared configuration for interacting with the Ika dWallet coordinator.
///
/// Holds one `DWalletEntry` per curve (so the package can sign across several
/// curves) and the sponsored fee pools shared across all of them.
public struct Signer has key, store {
    id: UID,
    /// Network encryption key the dWallet was created under.
    network_encryption_key_id: ID,
    /// Capability authorizing message approval for the dWallet.
    dwallet_cap: DWalletCap,

    /// Elliptic curve the dWallet was created under. Needed when requesting
    /// global presigns, which are keyed by curve + network encryption key
    /// rather than by a specific dWallet.
    curve: u32,
    signature_algorithm: u32,
    hash_scheme: u32,

    /// Pre-funded presign pools — Each signature consumes one
    /// (a presign is single-use), so `sign` pops from the back of the matching
    /// algorithm's vector instead of taking a cap on its params. Refill ahead of
    /// demand with `add_presign` / `add_presigns`.
    presigns: vector<UnverifiedPresignCap>,
    /// Sponsored Ika fee pool. `sign` pays the network from here, so callers
    /// don't have to supply IKA. Top up with `deposit_ika`.
    ika_balance: Balance<IKA>,
    /// Sponsored Sui fee pool for Ika protocol fees (separate from tx gas).
    /// Top up with `deposit_sui`.
    sui_balance: Balance<SUI>,
}

/// Shared object holding the payment policy and the USDC vault.
///
/// `verifier_pubkey` is the verifier's Ed25519 public key — the raw key, not an
/// address: a Sui address is `blake2b(flag ‖ pubkey)` and cannot be reversed into
/// a pubkey, while `ed25519_verify` needs the key bytes.
///
/// `usdc_balance` accumulates payments as a `Balance<USDC>` (the non-`Coin`
/// accumulator form); withdrawals are `AdminCap`-gated.
///
/// Has `key` only: a shared singleton that must never be wrapped or transferred.
public struct Protocol has key {
    id: UID,
    /// Ed25519 public key (32 bytes) of the trusted verifier.
    verifier_pubkey: vector<u8>,
    /// USDC collected from `pay_and_sign` callers.
    usdc_balance: Balance<USDC>,
}

// === Events ===

/// Emitted on every successful `pay_and_sign`.
public struct MessageSigned has copy, drop {
    sign_id: ID,
    /// Amount of USDC deposited into the treasury for this call.
    amount: u64,
}

// === Init ===

fun init(ctx: &mut TxContext) {
    transfer::transfer(
        AdminCap { id: object::new(ctx) },
        ctx.sender(),
    );
}

// === Admin ===

public fun create_signer(
    _: &AdminCap,
    coordinator: &mut DWalletCoordinator,
    curve: u32,
    signature_algorithm: u32,
    hash_scheme: u32,
    network_encryption_key_id: ID,
    // `dkgRequestInput.userDKGMessage` (centralized public key share & proof).
    centralized_public_key_share_and_proof: vector<u8>,
    // `dkgRequestInput.userPublicOutput`.
    user_public_output: vector<u8>,
    // `dkgRequestInput.userSecretKeyShare` — the PUBLIC user share.
    public_user_secret_key_share: vector<u8>,
    session_identifier_bytes: vector<u8>,
    initial_ika: Coin<IKA>,
    initial_sui: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let mut ika_coin = initial_ika;
    let mut sui_coin = initial_sui;

    let session = coordinator.register_session_identifier(
        session_identifier_bytes,
        ctx,
    );

    let (dwallet_cap, _) = coordinator.request_dwallet_dkg_with_public_user_secret_key_share(
        network_encryption_key_id,
        curve,
        centralized_public_key_share_and_proof,
        user_public_output,
        public_user_secret_key_share,
        option::none(), // sign_during_dkg_request
        session,
        &mut ika_coin,
        &mut sui_coin,
        ctx,
    );

    let signer = Signer {
        id: object::new(ctx),
        dwallet_cap,
        curve,
        signature_algorithm,
        hash_scheme,
        presigns: vector[],
        ika_balance: ika_coin.into_balance(),
        sui_balance: sui_coin.into_balance(),
        network_encryption_key_id,
    };

    transfer::public_share_object(signer);
}

/// Create and share the `Protocol` with an empty USDC vault.
///
/// `verifier_pubkey` must be a 32-byte Ed25519 public key.
public fun create_protocol(
    _: &AdminCap,
    verifier_pubkey: vector<u8>,
    ctx: &mut TxContext,
) {
    assert!(verifier_pubkey.length() == ED25519_PUBKEY_LEN, EInvalidPublicKey);

    let protocol = Protocol {
        id: object::new(ctx),
        verifier_pubkey,
        usdc_balance: balance::zero<USDC>(),
    };

    transfer::share_object(protocol);
}

/// Rotate the trusted verifier's public key. Must be 32 bytes (Ed25519).
public fun set_verifier_pubkey(_: &AdminCap, protocol: &mut Protocol, verifier_pubkey: vector<u8>) {
    assert!(verifier_pubkey.length() == ED25519_PUBKEY_LEN, EInvalidPublicKey);
    protocol.verifier_pubkey = verifier_pubkey;
}

/// Withdraw `amount` of USDC from the vault as a `Coin`, gated by `AdminCap`.
public fun withdraw_usdc(
    _: &AdminCap,
    protocol: &mut Protocol,
    amount: u64,
    ctx: &mut TxContext,
): Coin<USDC> {
    protocol.usdc_balance.split(amount).into_coin(ctx)
}

// === Helpers ===

/// Draw the entire sponsored fee pools (`ika_balance` / `sui_balance`) out as
/// working coins to hand to a coordinator call. The coordinator deducts its
/// fees from these; pair every call with `return_payment_coins` to put the
/// change back so the pools never leak balance.
fun withdraw_payment_coins(self: &mut Signer, ctx: &mut TxContext): (Coin<IKA>, Coin<SUI>) {
    let ika = self.ika_balance.withdraw_all().into_coin(ctx);
    let sui = self.sui_balance.withdraw_all().into_coin(ctx);
    (ika, sui)
}

/// Return leftover payment coins to the sponsored fee pools after a coordinator
/// call has deducted its fees. The inverse of `withdraw_payment_coins`.
fun return_payment_coins(self: &mut Signer, ika: Coin<IKA>, sui: Coin<SUI>) {
    self.ika_balance.join(ika.into_balance());
    self.sui_balance.join(sui.into_balance());
}

// === Funding ===

/// Deposit IKA into the sponsored fee pool. Anyone can top up.
public fun deposit_ika(self: &mut Signer, coin: Coin<IKA>) {
    self.ika_balance.join(coin.into_balance());
}

/// Deposit SUI into the sponsored fee pool. Anyone can top up.
public fun deposit_sui(self: &mut Signer, coin: Coin<SUI>) {
    self.sui_balance.join(coin.into_balance());
}

// === Public ===

public fun add_presign(
    self: &mut Signer,
    coordinator: &mut DWalletCoordinator,
    ctx: &mut TxContext,
) {
    add_presigns(self, coordinator, 1, ctx);
}

public fun add_presigns(
    self: &mut Signer,
    coordinator: &mut DWalletCoordinator,
    count: u64,
    ctx: &mut TxContext,
) {
    // Draw the whole sponsored pools as working coins, let the coordinator
    // deduct its per-presign fees, then return the change to the pools.
    let (mut ika_coin, mut sui_coin) = self.withdraw_payment_coins(ctx);

    let mut i = 0;
    while (i < count) {
        let session = coordinator.register_session_identifier(
            ctx.fresh_object_address().to_bytes(),
            ctx,
        );
        // This network's config only permits global presigns for the dWallet's
        // curve + signature algorithm, so `request_presign` (dWallet-bound)
        // aborts with `EOnlyGlobalPresignAllowed` (code 31). Global presigns are
        // keyed by curve + network encryption key and are valid for signing
        // under this dWallet.
        let presign_cap = coordinator.request_global_presign(
            self.network_encryption_key_id,
            self.curve,
            self.signature_algorithm,
            session,
            &mut ika_coin,
            &mut sui_coin,
            ctx,
        );
        self.presigns.push_back(presign_cap);
        i = i + 1;
    };

    self.return_payment_coins(ika_coin, sui_coin);
}

public fun pay_and_sign(
    self: &mut Protocol,
    signer: &mut Signer,
    coordinator: &mut DWalletCoordinator,
    payment: Coin<USDC>,
    message: vector<u8>,
    message_centralized_signature: vector<u8>,
    // The verifier's Ed25519 signature over the attested data.
    verifier_signature: vector<u8>,
    ctx: &mut TxContext,
): ID {
    // 0. Authorize: the verifier must have signed the attested data, else revert.
    // TODO: hardcoded boilerplate — replace b"data1234" with the real payment
    // context (e.g. message hash + amount + a per-call nonce) to bind the
    // signature to this specific call and prevent replay.
    let data = b"data1234";
    assert!(
        ed25519::ed25519_verify(&verifier_signature, &self.verifier_pubkey, &data),
        EInvalidVerifierSignature,
    );

    // 0b. Collect payment. Any amount is accepted for now (validated later) and
    // deposited whole into the vault.
    let amount = payment.value();
    self.usdc_balance.join(payment.into_balance());

    let (mut ika, mut sui) = signer.withdraw_payment_coins(ctx);

    // 1. Pop and verify presign
    let unverified_presign = signer.presigns.swap_remove(0);
    let verified_presign = coordinator.verify_presign_cap(unverified_presign, ctx);

    // 2. Create message approval
    let approval = coordinator.approve_message(
        &signer.dwallet_cap,
        signer.signature_algorithm,
        signer.hash_scheme,
        message,
    );

    // 3. Create session identifier
    let session = coordinator.register_session_identifier(
        ctx.fresh_object_address().to_bytes(),
        ctx,
    );

    // 4. Request signature
    let sign_id = coordinator.request_sign_and_return_id(
        verified_presign,
        approval,
        message_centralized_signature,
        session,
        &mut ika,
        &mut sui,
        ctx,
    );

    signer.return_payment_coins(ika, sui);

    event::emit(MessageSigned { sign_id, amount });

    sign_id
}
