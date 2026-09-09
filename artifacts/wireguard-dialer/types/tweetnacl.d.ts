declare module 'tweetnacl' {
  type RandomSource = (x: Uint8Array, n: number) => void;
  type BoxKeyPair = { publicKey: Uint8Array; secretKey: Uint8Array };
  const nacl: {
    box: {
      secretKeyLength: number;
      keyPair(): BoxKeyPair;
    };
    setPRNG(source: RandomSource): void;
  };
  export default nacl;
}