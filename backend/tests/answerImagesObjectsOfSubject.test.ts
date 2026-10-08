// IMGQ-05 follow-up (2026-10-08): a Commons file can sit in the subject's own
// category and name the subject in its caption and still not be a picture of
// it: a ticket stub, a chip die, a protest sign. The inputs are the exact
// titles, captions and visible categories of the tiles the judged sample
// (data-scratch/chat-ab/img05-judged-1008, every tile opened by eye) marked
// wrong-subject or private-person, plus right tiles from the same rows that
// must stay.
import { describe, expect, test } from "bun:test";
import { judgeRelevance, subjectNames, type RelevanceContext, type RelevanceInput } from "@/lib/answerImages/relevance";

type Extra = Partial<Pick<RelevanceInput, "objectName" | "categories" | "restrictions" | "width" | "lead">>;
const commons = (title: string, description: string, categories: string[], extra: Extra = {}): RelevanceInput => ({ source: "wikimedia", lead: false, title, description, categories, page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(title)}.jpg`, image: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${encodeURIComponent(title)}.jpg/1280px-x.jpg`, ...extra });
const thing = (names: string[], commonsCategory: string, description = ""): RelevanceContext => ({ names: subjectNames(names), subjectIsPerson: false, band: "adult", commonsCategory, ...(description ? { description } : {}) });
const person = (names: string[], commonsCategory: string): RelevanceContext => ({ names: subjectNames(names), subjectIsPerson: true, band: "adult", commonsCategory });

describe("a tile that shows an object belonging to the subject is dropped", () => {
  test("the Pontiac Fiero's headrest speakers", () => {
    const fiero = thing(["Pontiac Fiero"], "Pontiac Fiero", "mid-engine sports car");
    expect(judgeRelevance(commons("417096 12 full", "A picture of the stereo speakers inbedded in the headrest of an early Pontiac Fiero", ["Automobile seat belts", "Head restraints", "Pontiac Fiero"]), fiero)).toBe("object:head restraints");
    expect(judgeRelevance(commons("417096 12 full", "A picture of the stereo speakers inbedded in the headrest of an early Pontiac Fiero", ["Pontiac Fiero"]), fiero)).toBe("object:speakers");
    expect(judgeRelevance(commons("Pontiac Fiero (5084994364)", "Pontiac Fiero", ["1980s red coupes", "Pontiac Fiero", "Red Pontiac coupes"]), fiero)).toBeNull();
    expect(judgeRelevance(commons("MHV Pontiac Fiero 01", "Pontiac Fiero Verkehrszentrum Parent institution Deutsches Museum Location Munich , Germany", ["1980s red coupes", "Automobiles in the Deutsches Museum Verkehrszentrum", "Pontiac Fiero", "Red Pontiac coupes"]), fiero)).toBeNull();
  });

  test("the PlayStation 5's APU chip dies", () => {
    const ps5 = thing(["PlayStation 5", "PS5"], "PlayStation 5", "home video game console");
    const file = "AMD@7nm@Zen2 RDNA APU@Oberon@PlayStation5@CXD90060GG 100-000000189 WM33440U00089 S DSC04633-DSC04633";
    expect(judgeRelevance(commons(file, "PlayStation 5 (Oberon/Flute Zen2/RDNA APU)", ["CXD90060GG", "PlayStation 5"]), ps5)).toBe("object:apu");
  });

  test("the Taj Mahal's signage plaque, and a pavilion opposite it", () => {
    const taj = thing(["Taj Mahal"], "Taj Mahal", "mausoleum in Agra");
    expect(judgeRelevance(commons("ASI Signage - Taj Mahal - Taj Mahal Complex - Agra 2014-05-14 3998", "This is a photo of ASI monument number N-UP-A3.", ["Taj Mahal"]), taj)).toBe("object:signage");
    expect(judgeRelevance(commons("Mehtab Bagh on the river bank opposite the Taj Mahal, 2011-12-28", "This is a photo of ASI monument number N-UP-A28.", ["Mehtab Bagh", "Taj Mahal"]), taj)).toBe("near:opposite");
    expect(judgeRelevance(commons("Taj Mahal (Edited)", "Taj Mahal (Edited)", ["Clouds and blue sky in India", "South side of the Taj Mahal Tomb with the pool"], { lead: true }), taj)).toBeNull();
  });

  test("The Starry Night's colour histogram", () => {
    const starry = thing(["The Starry Night", "Starry Night"], "The Starry Night by van Gogh", "painting by Vincent van Gogh");
    expect(judgeRelevance(commons("Starry night color histogram", "Color histogram of two versions of The Starry Night , File:VanGogh-starry night.jpg [1]", ["Derivative artworks based on The Starry Night by van Gogh", "The Starry Night by van Gogh"]), starry)).toBe("object:histogram");
    expect(judgeRelevance(commons("Starry Night Painting", "Painting of The Starry Night at MoMA", ["The Starry Night by van Gogh"]), starry)).toBeNull();
  });

  test("gallery visitors in The Starry Night's category (people categories)", () => {
    const starry = thing(["The Starry Night", "Starry Night"], "The Starry Night by van Gogh", "painting by Vincent van Gogh");
    const cats = ["March 2008 in Manhattan, New York City", "People with art at the Museum of Modern Art", "Standing people in Manhattan, New York City", "The Starry Night by van Gogh", "Van Gogh collections and exhibitions"];
    expect(judgeRelevance(commons("Starry-night-in-moma-gallery", "The Starry Night as it appears in the Museum of Modern Art.", cats), starry)).toBe("category:people with");
  });

  test("the Lakers' ticket stubs and a fan in costume", () => {
    const lakers = thing(["Los Angeles Lakers", "Lakers"], "Los Angeles Lakers", "basketball team");
    const cats = ["1990–91 NBA season", "Basketball tickets from the United States", "Chicago Bulls", "Los Angeles Lakers", "National Basketball Association tickets", "Ticketmaster"];
    expect(judgeRelevance(commons("1991 NBA Finals - Game 4 - Chicago Bulls at Los Angeles Lakers 1991-06-09 (ticket)", "A ticket for Game 4 of the 1991 NBA Finals featuring the Chicago Bulls versus the Los Angeles Lakers at the Great Western Forum on June 9, 1991.", cats), lakers)).toBe("object:tickets");
    expect(judgeRelevance(commons("DeLooper Lakers 30For30For30", "David DeLooper's costume earned him \"Fan of the Game\" when he visited the Los Angeles Lakers at the Staples Center.", ["David DeLooper", "Los Angeles Lakers"]), lakers)).toBe("caption:costume");
    expect(judgeRelevance(commons("LeBron James 2023", "James with the Los Angeles Lakers in 2023", ["LeBron James in 2023", "Los Angeles Lakers"]), lakers)).toBeNull();
    expect(judgeRelevance(commons("Carter vs Gasol, Lakers vs Magic", "Vince Carter goes up for a layup against Pau Gasol", ["Basketball games at Staples Center", "Los Angeles Lakers", "Orlando Magic"]), lakers)).toBeNull();
  });

  test("a bus advert for Manchester United keeps no place; the club's heritage plaque stays", () => {
    const united = thing(["Manchester United F.C.", "Manchester United"], "Manchester United FC", "association football club");
    const cats = ["Buses in Hong Kong photographed in February 2011", "Manchester United FC", "Turkish Airlines advertisements", "Wrap advertising on buses in Hong Kong"];
    expect(judgeRelevance(commons("HK Fortress Hill King's Road Turkish Airlines Bus body ads Manchester United Feb-2011", "香港 zh:炮台山 zh:英皇道 ，巴士車身廣告", cats), united)).toBe("object:advertisements");
    expect(judgeRelevance(commons("Bank Street plaque", "A plaque marking the location of the Bank Street ground used by Manchester United from 1893 to 1910.", ["Manchester United FC", "Plaques about association football in the United Kingdom"]), united)).toBeNull();
  });
});

describe("a person's row has no concert ticket and no strangers with banners", () => {
  const mj = person(["Michael Jackson"], "Michael Jackson");
  test("the Vienna concert ticket", () => {
    expect(judgeRelevance(commons("Austria Vienna Michael Jackson concert ticket", "Ticket for a Michael Jackson concert in Vienna", ["Concerts at Ernst-Happel-Stadion", "Michael Jackson", "Michael Jackson in 1997"]), mj)).toBe("object:ticket");
  });
  test("a stranger holding a protest sign and fans outside a courthouse", () => {
    expect(judgeRelevance(commons("Amsterdam 2004", "Fans protest Michael Jackson's innocence in the child molestation scandal in 2004", ["Michael Jackson"]), mj)).toBe("crowd:fans");
    expect(judgeRelevance(commons("Italian fans outside courthouse at Michael Jackson trial on may 2, 2005", "photo taken outside the courthouse in Santa Maria, California on May 2, 2005", ["Michael Jackson"]), mj)).toBe("crowd:fans");
  });
  test("a portrait of him stays", () => {
    expect(judgeRelevance(commons("Michael Jackson 1983 (3x4 cropped) (contrast)", "Michael Jackson 1983 (3x4 cropped) (contrast)", ["Michael Jackson in 1983"]), mj)).toBeNull();
  });
});

describe("what the live re-run showed once the first drops freed visible slots", () => {
  test("a serviceman who shares the singer's name", () => {
    const mj = person(["Michael Jackson"], "Michael Jackson");
    expect(judgeRelevance(commons("Diamonds shine bright- 100th MXS first sergeant, Senior Master Sgt Michael Jackson", "U.S. Air Force Senior Master Sgt. Michael Jackson, 100th Maintenance Squadron first sergeant, poses for a photo at RAF Mildenhall, England", ["Michael Jackson"]), mj)).toBe("namesake:sergeant");
  });
  test("offices built where the club's old ground was; the match photo stays", () => {
    const united = thing(["Manchester United F.C.", "Manchester United"], "Manchester United FC", "association football club");
    expect(judgeRelevance(commons("Fujitsu offices, Newton Heath", "The Fujitsu offices that occupy the location of Manchester United's former ground, North Road, in Newton Heath", ["Manchester United FC"]), united)).toBe("near:occupy");
    expect(judgeRelevance(commons("Manchester United v Tottenham Hotspur, 12 March 2022 (05)", "Manchester United v Tottenham Hotspur, 12 March 2022 (05)", ["Manchester United FC"]), united)).toBeNull();
  });
  test("a person on a couch holding a PS5 controller is not the console", () => {
    const ps5 = thing(["PlayStation 5", "PS5"], "PlayStation 5", "home video game console");
    expect(judgeRelevance(commons("InclusiveGameLab Person-with-PS5-Controller 01 CC-BY-SA", "A person sitting on a pink couch is holding a pink PlayStation 5 controller with both hands.", ["PlayStation 5"]), ps5)).toBe("caption:person");
  });
});

describe("a thing's lead image of a costumed character among a crowd is dropped", () => {
  test("Bluey entertains the crowds (the article's own lead, no categories read)", () => {
    const bluey = thing(["Bluey"], "Bluey");
    expect(judgeRelevance(commons("Bluey entertains the crowds at Under 5s Day", "", [], { lead: true }), bluey)).toBe("caption:crowds");
  });
  test("a lead that only names the thing stays", () => {
    const bluey = thing(["Bluey"], "Bluey");
    expect(judgeRelevance(commons("Bluey Heeler", "", [], { lead: true }), bluey)).toBeNull();
  });
});

describe("the subject's own kind of object is not an object that replaces it", () => {
  test("a smart speaker's own photos are not dropped as speakers", () => {
    const echo = thing(["Amazon Echo"], "Amazon Echo", "smart speaker");
    expect(judgeRelevance(commons("Amazon Echo Plus", "The Amazon Echo smart speaker on a shelf", ["Amazon Echo"]), echo)).toBeNull();
  });
  test("a subject whose own name holds the word keeps it (Ticket to Ride)", () => {
    const ride = thing(["Ticket to Ride"], "Ticket to Ride");
    expect(judgeRelevance(commons("Ticket to Ride box", "The Ticket to Ride board game box", ["Ticket to Ride"]), ride)).toBeNull();
  });
});
