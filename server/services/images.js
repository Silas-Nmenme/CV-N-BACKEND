import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env.js";
import { HttpError } from "../utils/helpers.js";

export const uploadRoot = path.resolve(process.cwd(), env.uploadDir);
const cloudEnabled = Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

if (cloudEnabled) {
  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });
}

function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: `cv-gadgets/${folder}`, resource_type: "image" }, (err, result) =>
      err ? reject(err) : resolve(result)
    );
    stream.end(buffer);
  });
}

/**
 * Re-encode every upload with sharp. This validates that it really is an image,
 * strips metadata and any embedded payloads, and gives us fast WebP files.
 */
export async function saveImage(buffer, { folder = "products", max = 1400, thumb = 480 } = {}) {
  let main, small;
  try {
    const base = sharp(buffer, { failOn: "error" }).rotate();
    main = await base.clone().resize({ width: max, height: max, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    small = await base.clone().resize({ width: thumb, height: thumb, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  } catch {
    throw new HttpError(400, "That file is not a valid image. Use JPG, PNG, WebP or AVIF.");
  }

  if (cloudEnabled) {
    const [a, b] = await Promise.all([uploadToCloudinary(main, folder), uploadToCloudinary(small, `${folder}/thumbs`)]);
    return { url: a.secure_url, thumb: b.secure_url, publicId: `${a.public_id}|${b.public_id}` };
  }

  const id = crypto.randomBytes(10).toString("hex");
  const dir = path.join(uploadRoot, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${id}.webp`), main);
  await fs.writeFile(path.join(dir, `${id}-thumb.webp`), small);
  return { url: `/uploads/${folder}/${id}.webp`, thumb: `/uploads/${folder}/${id}-thumb.webp`, publicId: "" };
}

export async function deleteImage(img) {
  try {
    if (!img) return;
    if (img.publicId && cloudEnabled) {
      for (const id of img.publicId.split("|").filter(Boolean)) await cloudinary.uploader.destroy(id);
      return;
    }
    for (const url of [img.url, img.thumb]) {
      if (url && url.startsWith("/uploads/")) {
        const file = path.resolve(uploadRoot, url.replace("/uploads/", ""));
        if (file.startsWith(uploadRoot + path.sep)) await fs.rm(file, { force: true });
      }
    }
  } catch (err) {
    console.warn("[images] delete failed:", err.message);
  }
}
