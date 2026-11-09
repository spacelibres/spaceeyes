import type { NextApiRequest, NextApiResponse } from "next";
import { GET as planet } from "../../../app/assets/planets/[body]/[file]/route";
import { GET as ring } from "../../../app/assets/planet-rings/[file]/route";
import { GET as galaxy } from "../../../app/assets/deep-space/[file]/route";
import { GET as stars } from "../../../app/api/starfield/[file]/route";
import { sendBufferedResourceResponse } from "../../../lib/buffered-resource-response";

export const config = { api: { bodyParser: false, responseLimit: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    res.status(405).end();
    return;
  }
  const path = req.query.asset;
  if (!Array.isArray(path)) { res.status(404).end(); return; }
  const controller = new AbortController();
  const close = () => { if (!res.writableFinished) controller.abort(); };
  res.once("close", close);
  try {
    const request = new Request("http://localhost/", { signal: controller.signal });
    let response: Response;
    if (path[0] === "planets" && path.length === 3)
      response = await planet(request, { params: Promise.resolve({ body: path[1], file: path[2] }) });
    else if (path[0] === "rings" && path.length === 2)
      response = await ring(request, { params: Promise.resolve({ file: path[1] }) });
    else if (path[0] === "galaxy" && path.length === 2)
      response = await galaxy(request, { params: Promise.resolve({ file: path[1] }) });
    else if (path[0] === "stars" && path.length === 2)
      response = await stars(request, { params: Promise.resolve({ file: path[1] }) });
    else { res.status(404).end(); return; }
    await sendBufferedResourceResponse(res, response, req.method);
  } catch {
    if (!res.destroyed && !res.writableEnded) res.status(500).end();
  } finally { res.off("close", close); }
}
