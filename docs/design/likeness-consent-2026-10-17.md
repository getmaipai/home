# Pictures, videos and styles that look like a household adult (2026-10-17)

Owner's ruling, 2026-10-17 (Jesse, in the session that closed VIDEO-GEN-12's open question): an adult may make a video, a picture
or a likeness style (LoRA) of a consenting household adult. This note is the design of that, built the same day. It changes
SAFETY.md's line "no feature is built whose purpose is generating imagery of identifiable real people" to name this one exception
(the household adult who agreed, nobody else). It changes nothing in [RULES.md](RULES.md): the age and surface gates still outrank it.

## The lines that stay

- Nothing sexual involving a minor or a minor-looking person. A child or a teen is never the subject of anything.
- No imagery of any real, identifiable person who is not a consenting household adult: public figures, other real people, guests,
  people outside the household. A style whose own description names a public figure is refused even with a proof.
- A photo of a real person is never turned into adult content (the photo editor's existing rule, applied to photos in video too).
  The second consent switch is for styles only.
- The ADULT-ONLY audience gate is the picture policy's own. A request that is not an adult on their own written chat screen (child,
  teen, guest, spoken turn, shared screen) never reaches the likeness decision.

## Consent: two switches, person scope, off by default

Spec keys `likeness.adults` ("Let other adults in this household make pictures, videos and styles that look like me") and
`likeness.adult_content` ("Including adult content"), spec-v0.1.156, on the person's own **Settings, Pictures and videos** page
(Account, adults only). Written only by an adult for themselves; an owner or admin may only turn one off (a revoke); nobody turns
one on for another person; a child, teen or guest never writes it (`assertCanSetLikeness`, `backend/tests/likenessConsent.test.ts`).
The second counts only while the first is on, and turning the first off turns the second off. Each change appends a
`LikenessConsent` record (id, option, state, source, clock stamp). Consent is read from the setting at the moment of each request
and again on every poll while a job waits; it is never cached.

## What a request must pass (`lib/likeness/decide.ts`)

1. The picture policy's gate for the requester (adult, written, own screen).
2. The subject is a living household adult (role owner, admin or adult and the birthdate-aware band is adult; not a guest, not a
   memorial profile). Anything else is refused as "minor" or "unknown".
3. The subject is the requester (needs nobody's yes, notifies nobody), or has `likeness.adults` on.
4. If the request is an adult-content one (`asksToUndress` on the words, the same reading the photo editor uses) the subject needs
   `likeness.adult_content` on as well. Without it the engine is also given a negative prompt for nudity. A word list cannot catch
   every phrasing; the negative prompt, the output being the requester's own and the subject's notification are the other half, and
   the post-render check stays the named gap VIDEO-GEN-12.
5. The Stack trusts this Home's key (`ensureStackTrust`), and Home signs a proof for this one thing.

## Three ways a likeness arrives

- **A saved style.** The add flow asks "Who does this style look like?": a household adult picker (adults who have not agreed are
  listed but cannot be picked) or "Nobody (not a real person)". A style of a person is always adult-only, must be added as a file
  (the proof is bound to the file's hash; a link's bytes can change), is recorded as a `LikenessAdapter` (subject or none), notifies
  the subject, and is removed from the library, queued and retried, when the subject turns the first switch off. Nobody means the
  Stack's old rule: a file whose description names a real person's likeness is refused. A style is only "of a person" because the
  adder said so; a file with no tell-tale words added as Nobody is the limit of any import check.
- **An attached photo, in chat.** `generate_video` with `from_picture: "attached"` and `photo_subject` (the name the requester gave,
  "me" for themselves). Resolved only against household adults; "someone else", a child or an unknown name is refused. The
  household's own chat model counts people and faces in the photo and answers whether anyone could be under 18 (counts only,
  never a name, structured output); the photo must be exactly one person, one face, nobody who might be under 18, otherwise it is
  refused. No picture model, no answer or any doubt refuses (fail closed). `POST /api/videos/animate` takes `photo_subject_id`
  for the same thing.
- **An uploaded photo in the editor.** Comment on a photo not made here needs "Who is in this photo?" (the same picker, "No one"
  for a place or thing). With no one named the photo must show no person (the same counts, zero people). With an adult named, the
  single-adult check, the decision and a proof apply, then the edit is previewed; consent is checked again on every poll and when
  Apply is pressed.
- A picture or clip that was itself made to look like someone carries that person in its provenance; animating or editing it later
  asks their agreement again. Temporary-chat likeness pictures are not offered as references at all.

## What the Stack checks (`stack/backend/src/lib/likeness.ts`)

An Ed25519 proof per request, signed by Home with a key derived from a seed in the keystore, bound to the picture's sha256, the
style's file hash (import) or the style's id (use), at most 30 minutes (Home uses 20), used once, checked when the request arrives
and again when the job starts (a job can wait minutes). Forged, expired, for another picture or purpose, replayed, or with no key
registered: refused. `image_source` is now required with a starting picture or edit: `generated` (hash checked),
`household_photo` (proof, adult audience) or `uploaded` (Home found no person). Output that rested on a proof or on a photo is not
recorded as a free starting picture. Trust on first use is the limit of key registration (loopback, Home the only caller); Home
registers at first use and reports a Stack that trusts a different key as "switched off, an admin can reset it".

## Taking it back

Immediately: the next request is refused (consent read live); every waiting or running picture, clip and edit preview of the
subject is stopped and the Stack's copy deleted; styles of them are queued for removal and removed now or on the next pass (boot
and every five minutes). Already finished and stored files stay with whoever made them; the settings page says so.

## Not built, and limits

- No post-render check of the output for the absolute lines (VIDEO-GEN-12 stays the named gap for that half).
- The declared subject is not matched against a face print: the requester says who is in the photo, the subject is told each time.
- An adult-only style folder at the household level (`generation.adult_adapters: restricted`) also hides likeness styles.
- Home's photo count depends on the chat model reading pictures (p32 and above); without it photos of people are not used.
