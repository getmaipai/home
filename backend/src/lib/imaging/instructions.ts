/**
 * Plain-words edit instructions any picture editor can send to the picture model. They carry no companion, chat or screen
 * detail, so the chat image editor and the companion creator say the same thing about faces and bodies.
 */
export const FACE_AND_BODY = "Keep the identical face: the same facial features, eyes, nose, mouth, skin tone, hair, expression and apparent age, so the person is clearly recognisable. Show the whole body of a normal person with a head, neck, torso and both arms and hands, never a floating head or bust. Keep the same garments everywhere: the same sleeve length, collar, fabric and colours on both arms and the body, with no change of outfit.";

/** Redraw a picture in another style without changing who it shows. */
export const restyleInstruction = (): string => `Redraw this same character in the new style, keeping the pose, colours and clothing. ${FACE_AND_BODY} If the source shows only part of the body, draw the missing parts to match.`;

/** Draw in what the frame cut off, leaving what is already shown untouched. */
export const fillCutOffInstruction = (edges: readonly string[]): string => `This picture cuts the character off at the ${edges.join(", ")}. Show the whole character: extend the picture to include the shoulders, both arms and hands and the rest of the body that are cut off, drawn naturally to match the clothing. ${FACE_AND_BODY} Keep everything already shown exactly as it is.`;

/** Paint the rest of a person into the empty area around a picture that was placed on a plain canvas; the picture itself is not to change. */
export const bodyFillInstruction = (): string => "Continue this picture downward and outward: draw the rest of the same one person's body in the empty grey area, with the shoulders, both arms and hands, the torso, legs and shoes, standing naturally with the arms at the sides, in clothing that matches what is already shown, in the same photographic or drawn style and lighting. There is exactly one person and one head. Do not change the part already drawn. Plain light grey background.";
