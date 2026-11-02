// /youcam: the YouCam evidence page (shared shell + a small gallery of real outputs).
import { shell, $ } from "./ui.js";

shell({ page: "youcam", speechText: () => "How we used YouCam. Every YouCam call Parasol makes, what it costs, and what we found." });

const items = [
  ["/demo/sam/face.jpg", null, "Sam: AI-generated face (YouCam AI Image Generator)"],
  ["/demo/ada/face.jpg", null, "Ada: AI-generated face (YouCam AI Image Generator)"],
  ["/demo/sam/face.jpg", "/demo/sam/redness.png", "Sam: YouCam redness mask"],
  ["/demo/ada/face.jpg", "/demo/ada/texture.png", "Ada: YouCam texture mask"],
  ["/demo/ada/day3.jpg", null, "Ada Day 3: YouCam Skin Simulation (oiliness 1.0)"],
  ["/demo/ada/day3.jpg", "/demo/ada/day3-acne.png", "Ada Day 3: acne mask after simulation"],
];
$("#gal").innerHTML = items.map(([img, mask, cap]) =>
  `<figure><div class="yc-mask"><img src="${img}" alt="${cap}" loading="lazy">${mask ? `<img src="${mask}" alt="" loading="lazy">` : ""}</div><figcaption>${cap}</figcaption></figure>`).join("");
