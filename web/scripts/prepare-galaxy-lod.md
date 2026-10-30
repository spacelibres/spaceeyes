# Offline galaxy HDR preparation

From the repository root, run `node --max-old-space-size=4096 web/scripts/prepare-galaxy-lod.ts`, then `node web/scripts/prepare-galaxy-lod-audit.ts`. The web package exposes the equivalent `npm run prepare:galaxy` command.

Install official Filament cmgen v1.79.0 in `web/.cache/galaxy-lod/bin/cmgen.exe`, or set `CMGEN` to the installed executable. Official Windows distribution: https://github.com/google/filament/releases/download/v1.79.0/filament-v1.79.0-windows.tgz. Tool acquisition is explicit; the preparation script never executes downloaded tools automatically. The script fetches the pinned official NASA 8K EXR if absent, verifies its 137307727-byte length and SHA256, and rejects any other source.

All raw source, tool binaries, intermediates and 684 generated tiles remain in ignored `.cache/galaxy-lod`. Seven resolutions are area-averaged in linear radiance, with longitude-wrap and pole-clamp two-pixel gutters. EXR bottom-up rows are converted once to top-down. No tone mapping, sRGB encoding or artificial radiance multiplier is applied. The actual NASA RGB range is [0,1]; exact black exists. Synthetic codec tests independently verify values above1 survive half-float encoding.

Filament cmgen computes diffuse32 irradiance and GGX specular128. Each specular mip is generated separately with `--extract-blur=mip/7` because cmgen's usual `--ibl-ld` mip curve differs from Bevy0.19.1's linear perceptual roughness lookup. cmgen squares that perceptual roughness internally. The cubemap X/Z permutation aligns Filament's `atan2(x,z)` panorama longitude with the galaxy mesh `atan2(z,x)` mapping; pixel flips/transposes preserve exact samples. Cube face order is +X,-X,+Y,-Y,+Z,-Z.

Manifest publication occurs only after every tile and IBL image succeeds. GET never downloads or decodes EXR. It reads the prepared manifest with a 1MiB limit, validates all expected IDs, grids, sizes and source identity, and bounds/re-hashes every served asset. Missing preparation returns503.
