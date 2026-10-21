import json,sys,re
for path in sys.argv[1:]:
    d=json.load(open(path+"/results.json")); rows=d["runs"]
    L=[r for r in rows if r["item"].startswith("sp-l")]; R=[r for r in rows if r["item"].startswith("sp-r")]
    refuse=re.compile(r"\b(can't|cannot|can not|too many|not able)\b",re.I)
    items=lambda t: len([x for x in re.split(r",|\band\b|;",t) if x.strip()])
    listed=lambda r: items(r["reply"])>=5 and not refuse.search(r["reply"])
    opener=re.compile(r"^\W*(ooh|oh|whoa|yay|wow|hehe|aww|ha|hooray|nice|awesome|cool)\b",re.I)
    print(path.split("/")[-1],f"list requests answered with a list {sum(map(listed,L))}/{len(L)} | refused/can't {sum(1 for r in L if refuse.search(r['reply']))} | excited opener {sum(1 for r in R if opener.search(r['reply']))}/{len(R)} | avg words(list) {round(sum(r['words'] for r in L)/max(len(L),1))}")
    for r in L[:4]: print("   ",r["prompt"],"=>",r["reply"][:140].replace("\n"," "))
