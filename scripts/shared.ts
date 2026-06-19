import {
	CoordinatorInnerModule,
	Curve as IkaCurve,
	Hash as IkaHash,
	SignatureAlgorithm as IkaSignatureAlgorithm,
} from "@ika.xyz/sdk";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromHex, toHex } from "@mysten/sui/utils";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import crypto from "node:crypto";

if (!Bun.env.PUBLISHER_SECRET_KEY)
	throw new Error("PUBLISHER_SECRET_KEY is required");
if (!Bun.env.VERIFIER_SECRET_KEY)
	throw new Error("VERIFIER_SECRET_KEY is required");
if (!Bun.env.ROOT_SEED) throw new Error("ROOT_SEED is required");

export const publisher = Ed25519Keypair.fromSecretKey(
	Bun.env.PUBLISHER_SECRET_KEY,
);
export const verifier = Ed25519Keypair.fromSecretKey(
	Bun.env.VERIFIER_SECRET_KEY,
);
export const rootSeed = Bun.env.ROOT_SEED;

export const network = "testnet";
export const baseUrl = "https://fullnode.testnet.sui.io:443";

export const ikaCoinType =
	"0x1f26bb2f711ff82dcda4d02c77d5123089cb7f8418751474b9fb744ce031526a::ika::IKA" as const;
export const usdcCoinType =
	"0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC" as const;

export const curves = [0, 1, 2, 3] as const;
export type Curve = (typeof curves)[number];

export const parseIkaCurve = (curve: Curve): IkaCurve => {
	switch (curve) {
		case 0:
			return IkaCurve.SECP256K1;
		case 1:
			return IkaCurve.SECP256R1;
		case 2:
			return IkaCurve.ED25519;
		case 3:
			return IkaCurve.ED25519;
		default:
			throw new Error("Invalid curve");
	}
};

export const signatureAlgorithms = {
	0: [0, 1],
	1: [0],
	2: [0],
	3: [0],
} as const satisfies {
	[TCurve in Curve]: number[];
};
export type SignatureAlgorithm<TCurve extends Curve> =
	(typeof signatureAlgorithms)[TCurve][number];

export const parseIkaSignatureAlgorithm = <TCurve extends Curve>(
	curve: TCurve,
	signatureAlgorithm: SignatureAlgorithm<TCurve>,
): IkaSignatureAlgorithm => {
	switch (curve) {
		case 0:
			switch (signatureAlgorithm) {
				case 0:
					return IkaSignatureAlgorithm.ECDSASecp256k1;
				case 1:
					return IkaSignatureAlgorithm.Taproot;
				default:
					throw new Error("Invalid signature algorithm");
			}
		case 1:
			return IkaSignatureAlgorithm.ECDSASecp256r1;
		case 2:
			return IkaSignatureAlgorithm.EdDSA;
		case 3:
			return IkaSignatureAlgorithm.SchnorrkelSubstrate;
		default:
			throw new Error("Invalid curve");
	}
};

export const hashSchemes = {
	0: {
		0: [0, 1, 2],
		1: [0],
	},
	1: {
		0: [0],
	},
	2: {
		0: [0],
	},
	3: {
		0: [0],
	},
} as const satisfies {
	[TCurve in Curve]: {
		[TAlgorithm in SignatureAlgorithm<TCurve>]: number[];
	};
};
export type HashScheme<
	TCurve extends Curve,
	TAlgorithm extends SignatureAlgorithm<TCurve>,
> = TAlgorithm extends keyof (typeof hashSchemes)[TCurve]
	? (typeof hashSchemes)[TCurve][TAlgorithm] extends readonly (infer THash)[]
		? THash
		: never
	: never;

export const parseIkaHashScheme = <
	TCurve extends Curve,
	TAlgorithm extends SignatureAlgorithm<TCurve>,
>(
	curve: TCurve,
	signatureAlgorithm: TAlgorithm,
	hashScheme: HashScheme<TCurve, TAlgorithm>,
): IkaHash => {
	switch (curve) {
		case 0:
			switch (signatureAlgorithm) {
				case 0:
					switch (hashScheme) {
						case 0:
							return IkaHash.KECCAK256;
						case 1:
							return IkaHash.SHA256;
						case 2:
							return IkaHash.DoubleSHA256;
						default:
							throw new Error("Invalid hash scheme");
					}
				case 1:
					return IkaHash.SHA256;
				default:
					throw new Error("Invalid signature algorithm");
			}
		case 1:
			return IkaHash.SHA256;
		case 2:
			return IkaHash.SHA512;
		case 3:
			return IkaHash.Merlin;
		default:
			throw new Error("Invalid curve");
	}
};

/// A Sui object id as its raw 32 address bytes. An id BCS-encodes as a fixed
/// 32-byte array with no length prefix, so this matches `object::id(_).to_bytes()`.
const ID = bcs.fixedArray(32, bcs.u8()).transform({
	input: (id: string) => fromHex(id.startsWith("0x") ? id.slice(2) : id),
	output: (id) => `0x${toHex(Uint8Array.from(id))}`,
});

const UID = bcs.struct("UID", {
	id: ID,
});

export const Signer = bcs.struct("Signer", {
	id: UID,
	network_encryption_key_id: ID,
	dwallet_cap: CoordinatorInnerModule.DWalletCap,
	curve: bcs.U32,
	signature_algorithm: bcs.U32,
	hash_scheme: bcs.U32,
	presigns: bcs.vector(CoordinatorInnerModule.UnverifiedPresignCap),
	ika_balance: bcs.U64,
	sui_balance: bcs.U64,
});

export const SignerCreatedEvent = bcs.struct("SignerCreated", {
	signer_id: ID,
	network_encryption_key_id: ID,
	curve: bcs.U32,
	signature_algorithm: bcs.U32,
	hash_scheme: bcs.U32,
});

export const ProtocolCreatedEvent = bcs.struct("ProtocolCreated", {
	protocol_id: ID,
	verifier_pubkey: bcs.vector(bcs.U8),
});

export const PaymentSucceedEvent = bcs.struct("PaymentSucceed", {
	sign_id: ID,
	amount: bcs.U64,
});

export const createNonce = (): `0x${string}` =>
	`0x${crypto.getRandomValues(new Uint8Array(32)).toHex()}`;

export type PayAndSignPreimage = {
	protocolId: string;
	signerId: string;
	coordinatorId: string;
	amount: bigint;
	message: Uint8Array;
	messageCentralizedSignature: Uint8Array;
	validBefore: number;
};

export const buildPayAndSignAttestationBytes = ({
	protocolId,
	signerId,
	coordinatorId,
	amount,
	message,
	messageCentralizedSignature,
	validBefore,
}: PayAndSignPreimage): Uint8Array =>
	keccak_256(
		concatBytes(
			utf8ToBytes("pay_and_sign"),
			ID.serialize(protocolId).toBytes(),
			ID.serialize(signerId).toBytes(),
			ID.serialize(coordinatorId).toBytes(),
			bcs.u64().serialize(amount).toBytes(),
			message,
			keccak_256(messageCentralizedSignature),
			bcs.u64().serialize(validBefore).toBytes(),
		),
	);
