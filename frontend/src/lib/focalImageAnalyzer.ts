import { getOrLoadSession, tensorFor } from "@/lib/onnx/session-runtime";
type FocalMapAnalyzer = (input: Float32Array) => Promise<Float32Array>;

/** The shared image component supplies its locally sampled 256×256 NCHW input. The model never receives image data over the network. */
let queue = Promise.resolve();
export const analyzeFocalImage: FocalMapAnalyzer = (input) => {
  const result = queue.then(async () => {
    const session = await getOrLoadSession("/api/vision/model/focalnet.onnx");
    const tensor = await tensorFor(input, [1, 3, 256, 256]);
    const output = await session.run({ image: tensor });
    const map = output.importance?.data;
    if (!(map instanceof Float32Array) || map.length !== 64 * 64) throw new Error("FocalNet returned an unexpected importance map");
    return map;
  });
  queue = result.then(() => {}, () => {});
  return result;
};
