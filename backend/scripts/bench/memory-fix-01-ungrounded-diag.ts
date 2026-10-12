export {}
const { rejectUngrounded } = await import("@/lib/memoryJudge");
const { tokenize } = await import("@/lib/text");
const cases: [string,string,string][] = [
 ["Rover needs a long walk before 10:00 AM","My dog Rover needs a long walk before ten","Sage"],
 ["Rover needs a long walk before ten","My dog Rover needs a long walk before ten","Sage"],
 ["Sage's students have a chemistry exam on Friday, October 16, 2026","My students have their chemistry exam on Friday","Sage"],
 ["Sage's students have a chemistry exam on Friday","My students have their chemistry exam on Friday","Sage"],
 ["Nadia loves the film 'The Marsh Lantern'","I love the Marsh Lantern film, it's my favourite","Nadia"],
 ["'The Marsh Lantern' is Nadia's favourite film","I love the Marsh Lantern film, it's my favourite","Nadia"],
 ["Nadia loves the Marsh Lantern film","I love the Marsh Lantern film, it's my favourite","Nadia"],
];
for (const [t,u,sp] of cases) {
  const r = rejectUngrounded([{ text: t, category: "fact", scope: "person", importance: 0.5 } as any], sp, "October 11, 2026", u, null);
  console.error(r.kept.length ? "KEPT   " : "DROPPED", t, "| tokens:", [...tokenize(t)].join(","));
}
process.exit(0);
