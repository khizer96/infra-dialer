# Profile registration evidence

Use the acceptance harness for a repeatable registration check. It makes two
registrations so the evidence can prove that each request received a fresh
generated public key. Each registration may create a separate profile at the
service, so use a test account or clean up the test profiles afterward.

Provide credentials through the device or test runner's secret environment
storage. Do not put them on the command line, in a source file, or in a
captured log:

```sh
export PROFILE_ENDPOINT='https://vpn.example.com/profile'
export PROFILE_USERNAME='...'
export PROFILE_PASSWORD='...'
node artifacts/wireguard-dialer/tests/profile-registration-evidence.mjs > /tmp/profile-registration-evidence.json
```

The command prints only a redacted JSON record. Store the record outside the
repository and share it only through the approved device-test evidence store.
The repository ignores files placed in `evidence/` as an additional safeguard.

## Evidence format

The record contains:

- `captureMethod` and `httpMethod`: how the record was captured and the HTTP
  method used.
- `requestCount` and `statusCodes`: how many registrations ran and the HTTP
  result for each request. A `null` status means the request failed before a
  response arrived.
- `responseSuccess`: whether every registration returned a valid profile.
- `generatedPublicKeyFresh`: whether every request used a distinct 32-byte
  generated public key. The key values themselves are never recorded.
- `returnedProfileUsesGeneratedPrivateKey`: whether each returned profile used
  the private key generated locally for that request. The private keys are
  never recorded.
- `profile`: non-sensitive server, route, and assigned-address metadata from
  the latest successful profile.
- `redactions`: an explicit declaration that username, password, private key,
  and complete request/response bodies are omitted.

Example shape (safe to commit because it contains no real values):

```json
{
  "captureMethod": "profile-registration-acceptance-harness",
  "httpMethod": "POST",
  "requestCount": 2,
  "statusCodes": [200, 200],
  "responseSuccess": true,
  "generatedPublicKeyFresh": true,
  "returnedProfileUsesGeneratedPrivateKey": true,
  "profile": {
    "server": "vpn.example.com:51820",
    "routes": "0.0.0.0/0, ::/0",
    "address": "10.42.0.2/32"
  },
  "redactions": {
    "username": "[REDACTED]",
    "password": "[REDACTED]",
    "privateKey": "[REDACTED]",
    "requestBody": "[REDACTED]",
    "responseBody": "[REDACTED]"
  }
}
```