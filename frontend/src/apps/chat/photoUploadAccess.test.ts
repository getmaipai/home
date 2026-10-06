import { expect, test } from "bun:test";
import { photoUploadsEnabledForBand } from "@/apps/chat/photoUploadAccess";
import { createLocalImageAttachmentAdapter } from "@/apps/chat/localImageAttachmentAdapter";

test("photo control and upload queue use the backend band when role and birthdate disagree", () => {
  // Adult role with a child birthdate: backend age band is child.
  const adultRoleChildBand = { role: "adult", age_band: "child" as const };
  expect(photoUploadsEnabledForBand(adultRoleChildBand.age_band, { value: true, source: "default" })).toBe(false);
  // Child role with an adult birthdate: role remains the stricter floor.
  const childRoleChildBand = { role: "child", age_band: "child" as const };
  expect(photoUploadsEnabledForBand(childRoleChildBand.age_band, { value: true, source: "default" })).toBe(false);
  expect(photoUploadsEnabledForBand("child", { value: true, source: "user" })).toBe(true);
  expect(photoUploadsEnabledForBand(undefined, { value: true, source: "user" })).toBe(false);
});

test("a backend child band does not enqueue a selected picture when default photos are on", async () => {
  const adultRoleChildBand = { role: "adult", age_band: "child" as const };
  const adapter = createLocalImageAttachmentAdapter({
    enabled: () => photoUploadsEnabledForBand(adultRoleChildBand.age_band, { value: true, source: "default" }),
  });
  await expect(adapter.add({ file: new File(["photo"], "photo.jpg", { type: "image/jpeg" }) })).rejects.toThrow("Photo uploads are turned off");
});
