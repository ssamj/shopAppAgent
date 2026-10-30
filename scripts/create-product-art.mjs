import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("apps/web/public/products", { recursive: true });
const paths = {
  knit: {
    color: "#c8bba5",
    body: "M100 106 L135 86 Q160 102 185 86 L220 106 L260 188 L227 209 L208 163 L210 308 Q160 318 110 308 L112 163 L93 209 L60 188 Z",
    detail:
      "M135 86 Q137 117 160 117 Q183 117 185 86 M116 289 L204 289 M118 294 L202 294 M112 136 L111 282 M208 136 L209 282",
  },
  cardigan: {
    color: "#c7b3a3",
    body: "M100 106 L132 87 L160 135 L188 87 L220 106 L253 218 L223 230 L207 164 L208 302 L112 302 L113 164 L97 230 L67 218 Z",
    detail:
      "M132 87 L157 140 L157 300 M188 87 L164 140 L164 300 M113 270 L207 270 M127 213 L146 213 L146 242 L127 242 Z M176 213 L195 213 L195 242 L176 242 Z",
  },
  pants: {
    color: "#777b7b",
    body: "M105 76 L215 76 L223 165 L210 326 L167 326 L160 191 L153 326 L110 326 L97 165 Z",
    detail:
      "M103 99 L218 99 M160 99 L160 156 M113 100 Q119 131 100 143 M207 100 Q201 131 220 143 M135 135 L130 312 M186 135 L190 312 M112 312 L152 312 M168 312 L208 312",
  },
  dress: {
    color: "#655650",
    body: "M117 78 L139 72 L139 109 L181 109 L181 72 L203 78 L239 179 L213 191 L191 135 L189 176 Q210 226 232 325 Q160 343 88 325 Q110 226 131 176 L129 135 L107 191 L81 179 Z",
    detail:
      "M131 176 L189 176 M133 181 L187 181 M136 189 L122 320 M160 190 L160 329 M184 189 L198 320 M100 315 Q160 329 220 315",
  },
  shirt: {
    color: "#d6dde0",
    body: "M108 98 L138 80 L160 96 L182 80 L212 98 L255 203 L223 218 L205 162 L210 307 Q185 322 160 306 Q135 322 110 307 L115 162 L97 218 L65 203 Z",
    detail:
      "M138 80 L130 112 L151 129 L160 96 L169 129 L190 112 L182 80 M160 100 L160 306 M126 160 L147 160 L147 185 L126 185 Z M70 187 L101 202 M219 202 L250 187",
  },
  coat: {
    color: "#b9a58b",
    body: "M104 98 L139 80 L160 99 L181 80 L216 98 L256 207 L224 222 L206 169 L213 302 L107 302 L114 169 L96 222 L64 207 Z",
    detail:
      "M139 80 L125 119 L145 132 L132 148 L160 179 L188 148 L175 132 L195 119 L181 80 M160 179 L160 302 M122 232 L148 232 M174 232 L200 232 M112 286 L208 286",
  },
  blazer: {
    color: "#847c73",
    body: "M108 93 L139 78 L160 100 L181 78 L212 93 L250 237 L224 246 L204 159 L212 310 L166 318 L160 292 L154 318 L108 310 L116 159 L96 246 L70 237 Z",
    detail:
      "M139 78 L128 120 L145 130 L134 146 L160 194 L186 146 L175 130 L192 120 L181 78 M160 194 L160 292 M119 240 L146 240 M175 240 L201 240 M180 146 L196 141",
  },
  skirt: {
    color: "#7e665a",
    body: "M116 91 L204 91 L211 137 L241 316 Q160 337 79 316 L109 137 Z",
    detail:
      "M112 111 L208 111 M124 119 L112 311 M149 119 L144 319 M171 119 L176 319 M196 119 L208 311 M88 304 Q160 323 232 304",
  },
  vest: {
    color: "#c7b594",
    body: "M114 93 L139 84 L160 130 L181 84 L206 93 Q196 127 212 153 L208 293 Q160 306 112 293 L108 153 Q124 127 114 93 Z",
    detail:
      "M139 84 L160 141 L181 84 M118 276 L202 276 M118 283 L202 283 M137 155 Q125 173 137 191 Q149 209 137 227 Q125 245 137 263 M183 155 Q171 173 183 191 Q195 209 183 227 Q171 245 183 263",
  },
};
for (const [name, p] of Object.entries(paths)) {
  const buttons = ["shirt", "cardigan", "blazer"].includes(name)
    ? [158, 187, 216, 245, 274]
        .map(
          (y) =>
            `<circle cx="160" cy="${y}" r="2.3" fill="#78716c" opacity=".7"/>`,
        )
        .join("")
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400" viewBox="0 0 320 400"><defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#f4f2ee"/><stop offset="1" stop-color="#e9e5df"/></linearGradient><linearGradient id="fabric" x1="0" y1="0" x2="1" y2=".6"><stop stop-color="${p.color}"/><stop offset=".5" stop-color="${p.color}"/><stop offset="1" stop-color="#ffffff" stop-opacity=".26"/></linearGradient><filter id="shadow" x="-40%" y="-20%" width="180%" height="160%"><feDropShadow dx="1" dy="10" stdDeviation="8" flood-color="#5a5249" flood-opacity=".12"/></filter><pattern id="weave" width="3" height="3" patternUnits="userSpaceOnUse"><path d="M0 0H3M0 0V3" stroke="#ffffff" opacity=".12" stroke-width=".5"/></pattern></defs><path fill="url(#bg)" d="M0 0H320V400H0Z"/><ellipse cx="160" cy="347" rx="90" ry="9" fill="#a8a29e" opacity=".09"/><g filter="url(#shadow)"><path d="${p.body}" fill="${p.color}"/><path d="${p.body}" fill="url(#fabric)"/><path d="${p.body}" fill="url(#weave)"/><path d="${p.body}" fill="none" stroke="#3d342c" stroke-opacity=".16" stroke-width="1.2"/><path d="${p.detail}" fill="none" stroke="#3d342c" stroke-opacity=".26" stroke-width="1.5"/>${buttons}</g><text x="160" y="373" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" letter-spacing="3" fill="#a29b91">QI HE · WARDROBE</text></svg>`;
  writeFileSync(`apps/web/public/products/${name}.svg`, svg);
}
console.log(`Created ${Object.keys(paths).length} garment illustrations.`);
