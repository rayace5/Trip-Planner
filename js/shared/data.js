// Shared: static datasets — region climate/holiday profiles, destination catalog, and city-pair transport data.
'use strict';

// Generic (northern-hemisphere default) month desirability + season notes.
var GENERIC_MONTH_SCORE = { Jan:0, Feb:0, Mar:1, Apr:2, May:2, Jun:1, Jul:0, Aug:0, Sep:2, Oct:2, Nov:1, Dec:0 };
var GENERIC_NOTES = {
  Jan:'quiet low season', Feb:'quiet low season', Mar:'early shoulder season',
  Apr:'shoulder season, mild weather', May:'shoulder season, mild weather',
  Jun:'early summer, before peak crowds', Jul:'peak summer crowds and prices',
  Aug:'peak summer crowds and prices', Sep:'shoulder season, mild weather',
  Oct:'shoulder season, mild weather', Nov:'late shoulder season', Dec:'holiday high season'
};

// Major US travel-holiday weeks (apply to every trip — they drive flight
// prices/crowds from a US origin). from/to are days of the month.
var US_HOLIDAYS = {
  Jan:{ name:"New Year's week", from:1, to:2, majorDay:1 },
  May:{ name:'Memorial Day weekend', from:24, to:31 },
  Jul:{ name:'July 4th week', from:1, to:5, majorDay:4 },
  Sep:{ name:'Labor Day week', from:1, to:7 },
  Nov:{ name:'Thanksgiving week', from:22, to:28, majorDay:26 },
  Dec:{ name:'Christmas–New Year peak', from:23, to:31, majorDay:25 }
};

// A handful of notable regions, keyword-matched against the destination text.
var REGION_PROFILES = [
  {
    name:'Japan',
    keywords:['japan','tokyo','kyoto','osaka','hokkaido','okinawa','hiroshima','nagoya'],
    monthScore:{ Jan:1, Feb:1, Mar:3, Apr:3, May:2, Jun:0, Jul:0, Aug:0, Sep:1, Oct:3, Nov:3, Dec:1 },
    notes:{ Mar:'early cherry-blossom season, mild spring weather', Apr:'peak cherry-blossom season, mild spring weather',
      May:'pleasant late spring', Jun:'rainy season', Jul:'hot and humid', Aug:'hot and humid',
      Sep:'tail end of typhoon season', Oct:'crisp autumn weather', Nov:'autumn foliage, cool and clear', Dec:'cold but clear' },
    events:{ Mar:{ name:'cherry blossom season', day:24 }, Apr:{ name:'cherry blossom season', day:3 },
      Jul:{ name:'Gion Matsuri in Kyoto', day:14 }, Nov:{ name:'autumn foliage season', day:15 } },
    holidays:{ Apr:{ name:'Golden Week', from:29, to:30 }, May:{ name:'Golden Week', from:1, to:6 },
      Aug:{ name:'Obon week', from:13, to:16 }, Dec:{ name:'New Year holidays', from:28, to:31 } }
  },
  {
    name:'Europe',
    keywords:['europe','london','england','united kingdom','scotland','ireland','paris','france','italy','rome','florence','venice',
      'spain','barcelona','madrid','portugal','lisbon','greece','athens','amsterdam','netherlands','germany','berlin','munich',
      'prague','vienna','austria','switzerland','croatia'],
    monthScore:{ Jan:0, Feb:0, Mar:1, Apr:2, May:3, Jun:2, Jul:0, Aug:0, Sep:3, Oct:2, Nov:1, Dec:1 },
    notes:{ Apr:'spring shoulder season', May:'late-spring shoulder season, mild weather', Jun:'warm early summer, crowds building',
      Jul:'peak-season crowds and prices', Aug:'peak-season crowds and prices', Sep:'shoulder season, mild weather',
      Oct:'autumn shoulder season, mild weather', Dec:'Christmas-market season' },
    events:{ Feb:{ name:'Carnival season', day:10 }, Sep:{ name:'Oktoberfest (Munich)', day:20 }, Dec:{ name:'Christmas markets', day:5 } },
    holidays:{ Aug:{ name:'European August holidays', from:1, to:31 }, Dec:{ name:'Christmas–New Year peak', from:23, to:31, majorDay:25 } }
  },
  {
    name:'Southeast Asia',
    keywords:['southeast asia','thailand','bangkok','phuket','chiang mai','vietnam','hanoi','bali','indonesia','cambodia','laos',
      'malaysia','singapore','philippines'],
    monthScore:{ Jan:3, Feb:3, Mar:2, Apr:1, May:1, Jun:0, Jul:1, Aug:1, Sep:0, Oct:1, Nov:2, Dec:2 },
    notes:{ Jan:'dry season, best weather of the year', Feb:'dry season, best weather of the year', Mar:'dry but heating up',
      Apr:'hottest month of the year', Sep:'peak monsoon season', Oct:'monsoon tapering off', Nov:'monsoon ending, shoulder pricing',
      Dec:'dry season begins' },
    events:{ Apr:{ name:'Songkran water festival', day:13 }, Nov:{ name:'Loy Krathong lantern festival', day:15 } },
    holidays:{ Dec:{ name:'holiday high season', from:20, to:31, majorDay:25 } }
  },
  {
    name:'Mexico & Caribbean',
    keywords:['mexico','cancun','tulum','oaxaca','caribbean','bahamas','jamaica','puerto rico','dominican','aruba','costa rica','belize'],
    monthScore:{ Jan:2, Feb:3, Mar:2, Apr:2, May:1, Jun:0, Jul:0, Aug:0, Sep:0, Oct:0, Nov:2, Dec:2 },
    notes:{ Jan:'dry season', Feb:'dry season, ideal beach weather', Mar:'dry season', Apr:'dry season winding down',
      Aug:'hurricane season', Sep:'peak hurricane season', Oct:'hurricane season', Nov:'hurricane season ending, shoulder pricing',
      Dec:'dry season, holiday crowds late in the month' },
    events:{ Feb:{ name:'Carnival season', day:10 }, Nov:{ name:'Día de los Muertos', day:1 } },
    holidays:{ Mar:{ name:'spring-break weeks', from:7, to:21 }, Dec:{ name:'Christmas–New Year peak', from:20, to:31, majorDay:25 } }
  },
  {
    name:'Australia & New Zealand',
    keywords:['australia','sydney','melbourne','new zealand','auckland','queenstown','tasmania'],
    monthScore:{ Jan:1, Feb:2, Mar:3, Apr:2, May:1, Jun:0, Jul:0, Aug:0, Sep:1, Oct:2, Nov:3, Dec:1 },
    notes:{ Jan:'southern-hemisphere summer school holidays, peak domestic travel', Feb:'late southern summer',
      Mar:'southern-hemisphere autumn shoulder, mild weather', Apr:'autumn shoulder season', Jun:'southern winter',
      Jul:'southern winter', Aug:'southern winter', Oct:'spring shoulder season',
      Nov:'southern-hemisphere spring shoulder, mild weather', Dec:'southern summer peak season' },
    events:{ Mar:{ name:'harvest and festival season', day:10 } },
    holidays:{ Dec:{ name:'Christmas + summer school holidays', from:18, to:31, majorDay:25 }, Jan:{ name:'summer school holidays', from:1, to:26 } }
  },
  {
    name:'US Southwest & Texas',
    keywords:['texas','austin','dallas','houston','san antonio','arizona','phoenix','las vegas','new mexico'],
    monthScore:{ Jan:1, Feb:2, Mar:3, Apr:3, May:2, Jun:0, Jul:0, Aug:0, Sep:1, Oct:3, Nov:2, Dec:1 },
    notes:{ Mar:'spring shoulder, wildflower season', Apr:'spring shoulder, warm not scorching', May:'warming up fast',
      Jun:'triple-digit heat', Jul:'triple-digit heat', Aug:'triple-digit heat', Sep:'still hot, crowds thinning',
      Oct:'autumn shoulder, summer heat broken', Nov:'mild autumn weather' },
    events:{ Mar:{ name:'SXSW (Austin)', day:13 }, Oct:{ name:'State Fair of Texas (Dallas)', day:1 } },
    holidays:{}
  }
];

// Per-proposal fit attributes (0 = poor fit, 1 = workable, 2 = strong fit):
//   english: 2 = predominantly spoken, 1 = widely spoken in visitor areas, 0 = limited.
//   access:  limited-mobility friendliness — flat, modern, step-free-friendly (2)
//            vs stairs/hills/cobbles/uneven streets (0).
//   kid:     ease of travel with young kids.
//   pet:     pet logistics — 2 only where domestic/road-trippable with pet-friendly
//            lodging common; long-haul international trips are generally poor for pets.
//   solo:    female-solo-travel fit (compact, well-trafficked areas, reliable public
//            transit) — deliberately conservative, no specific safety-statistic claims.
var DESTINATION_CATALOG = [
  { keywords:['portugal','lisbon','porto','algarve'], profile:'Europe', proposals:[
    { cities:['Lisbon'], english:1, walkable:true, bucket:false, access:0, kid:1, pet:0, solo:2, styles:['Cultural exploration','Balanced mix'],
      why:'Hilltop viewpoints, historic trams, and standout food at gentler prices than most of Western Europe',
      tradeoff:'Steep cobbled hills take some legwork' },
    { cities:['Lisbon','Porto'], english:1, walkable:true, bucket:false, access:0, kid:1, pet:0, solo:2, styles:['Cultural exploration','Balanced mix'],
      why:'Two very different Portuguese cities linked by an easy 3-hour train',
      tradeoff:'A hotel change and a travel day mid-trip' },
    { cities:['Algarve (Lagos)'], english:1, walkable:false, bucket:false, access:1, kid:2, pet:0, solo:1, styles:['Relaxation'],
      why:'Cliff-backed beaches and slow coastal towns along Portugal\'s southern coast',
      tradeoff:'The best beaches and coves are easiest to reach by car' } ] },
  { keywords:['greece','greek','athens','santorini','crete','mykonos'], profile:'Europe', proposals:[
    { cities:['Athens','Santorini'], english:1, walkable:true, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration','Relaxation','Balanced mix'],
      why:'Ancient Athens paired with caldera sunsets — the classic Greece combination',
      tradeoff:'Santorini gets crowded and pricey in peak summer' },
    { cities:['Athens'], english:1, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:1, styles:['Cultural exploration'],
      why:'The Acropolis, layered history, and a lively food scene in one compact capital',
      tradeoff:'Less of a beach-and-islands feel than the rest of Greece' },
    { cities:['Crete (Chania)'], english:1, walkable:false, bucket:false, access:0, kid:1, pet:0, solo:1, styles:['Relaxation','Adventure'],
      why:'Beaches, gorge hikes, and Venetian harbor towns on Greece\'s largest island',
      tradeoff:'A rental car unlocks the best beaches and gorges' } ] },
  { keywords:['spain','barcelona','madrid','seville','andalusia'], profile:'Europe', proposals:[
    { cities:['Barcelona'], english:1, walkable:true, bucket:true, access:1, kid:2, pet:0, solo:1, styles:['Balanced mix','Cultural exploration'],
      why:'Gaudí architecture, city beaches, and late-night food culture in one compact city',
      tradeoff:'Heavily touristed center — watch for pickpockets' },
    { cities:['Madrid','Seville'], english:1, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:2, styles:['Cultural exploration'],
      why:'Big-museum Madrid plus flamenco-and-orange-tree Seville, 2.5 hours apart by fast train',
      tradeoff:'Seville is punishingly hot in midsummer' } ] },
  { keywords:['italy','rome','florence','venice','amalfi','tuscany','sicily'], profile:'Europe', proposals:[
    { cities:['Rome','Florence'], english:1, walkable:true, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration','Balanced mix'],
      why:'Italy\'s greatest-hits pairing — ancient Rome and Renaissance Florence, 90 minutes apart by train',
      tradeoff:'Both centers are very touristed in high season' },
    { cities:['Rome'], english:1, walkable:true, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration'],
      why:'The Colosseum, the Vatican, and trattoria dinners without changing hotels',
      tradeoff:'Big, busy, and hot at the height of summer' },
    { cities:['Amalfi Coast (Positano)'], english:1, walkable:false, bucket:true, access:0, kid:0, pet:0, solo:1, styles:['Relaxation'],
      why:'Cliffside villages, boat days, and long lunches on Italy\'s most famous coastline',
      tradeoff:'Steep prices and stairs; getting around takes ferries and buses' } ] },
  { keywords:['france','paris','nice','provence','riviera'], profile:'Europe', proposals:[
    { cities:['Paris'], english:1, walkable:true, bucket:true, access:1, kid:1, pet:0, solo:1, styles:['Cultural exploration','Balanced mix'],
      why:'Museums, cafés, and neighborhood wandering in the classic city-break capital',
      tradeoff:'Premium prices for central hotels' },
    { cities:['Paris','Nice'], english:1, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:1, styles:['Balanced mix','Relaxation'],
      why:'Capital culture plus Riviera beach time, connected by a direct train or short flight',
      tradeoff:'A travel day mid-trip to swap coasts' } ] },
  { keywords:['united kingdom','england','london','britain','scotland','edinburgh'], profile:'Europe', proposals:[
    { cities:['London'], english:2, walkable:true, bucket:true, access:1, kid:2, pet:0, solo:2, styles:['Cultural exploration','Balanced mix'],
      why:'World-class museums, theatre, and markets — all in English and easy on the Tube',
      tradeoff:'One of Europe\'s most expensive cities' },
    { cities:['London','Edinburgh'], english:2, walkable:true, bucket:false, access:0, kid:1, pet:0, solo:2, styles:['Cultural exploration','Adventure'],
      why:'England\'s capital plus Scotland\'s castle-topped old town, linked by a scenic 4.5-hour train',
      tradeoff:'More ground to cover on a shorter trip' } ] },
  { keywords:['ireland','irish','dublin','galway'], profile:'Europe', proposals:[
    { cities:['Dublin','Galway'], english:2, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:2, styles:['Balanced mix','Cultural exploration'],
      why:'Pub culture and Georgian Dublin plus the west-coast gateway to the Cliffs of Moher',
      tradeoff:'Frequent rain in any season' },
    { cities:['Dublin'], english:2, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:2, styles:['Cultural exploration'],
      why:'A compact, friendly capital of literary history and live music',
      tradeoff:'A smaller sight list than the bigger European capitals' } ] },
  { keywords:['japan','tokyo','kyoto','osaka'], profile:'Japan', proposals:[
    { cities:['Tokyo','Kyoto'], english:0, walkable:true, bucket:true, access:1, kid:1, pet:0, solo:2, styles:['Cultural exploration','Balanced mix'],
      why:'Neon Tokyo and temple-filled Kyoto, linked by a 2-hour bullet train',
      tradeoff:'Long-haul flights and a faster pace than a single-city stay' },
    { cities:['Tokyo'], english:0, walkable:true, bucket:true, access:2, kid:2, pet:0, solo:2, styles:['Balanced mix','Cultural exploration'],
      why:'Food, neighborhoods, and pop culture in the world\'s biggest city — no hotel changes',
      tradeoff:'You\'d miss Kyoto\'s temples without a side trip' },
    { cities:['Kyoto','Osaka'], english:0, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:2, styles:['Cultural exploration'],
      why:'Temples and gardens by day, Osaka\'s street-food scene 15 minutes away by train',
      tradeoff:'Quieter evenings than Tokyo' } ] },
  { keywords:['thailand','thai','bangkok','chiang mai','phuket','krabi'], profile:'Southeast Asia', proposals:[
    { cities:['Bangkok','Chiang Mai'], english:1, walkable:false, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration','Adventure','Balanced mix'],
      why:'Bangkok\'s temples and street food plus Chiang Mai\'s old city and mountain day trips',
      tradeoff:'A domestic flight mid-trip; city hops rely on taxis and tuk-tuks' },
    { cities:['Phuket'], english:1, walkable:false, bucket:false, access:1, kid:2, pet:0, solo:1, styles:['Relaxation'],
      why:'Resort beaches and island-hopping boat days in Thailand\'s south',
      tradeoff:'Touristy in parts; beach-hopping needs taxis or a scooter' },
    { cities:['Bangkok'], english:1, walkable:false, bucket:false, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration','Balanced mix'],
      why:'Temples, markets, and arguably the world\'s best street food from one base',
      tradeoff:'Hot, hectic traffic — plan around the BTS Skytrain' } ] },
  { keywords:['southeast asia','south east asia','vietnam','hanoi','bali','indonesia','cambodia','singapore','malaysia','philippines','laos'], profile:'Southeast Asia', proposals:[
    { cities:['Bangkok','Chiang Mai'], english:1, walkable:false, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration','Adventure','Balanced mix'],
      why:'The classic Southeast Asia intro — big-city energy plus laid-back northern temples',
      tradeoff:'A domestic flight mid-trip; getting around relies on taxis' },
    { cities:['Ubud','Seminyak'], english:1, walkable:false, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Relaxation','Adventure'],
      why:'Bali two ways — jungle-and-rice-terrace Ubud plus beach-club Seminyak',
      tradeoff:'Traffic between areas is slow — hire drivers for hops' },
    { cities:['Singapore'], english:2, walkable:true, bucket:false, access:2, kid:2, pet:0, solo:2, styles:['Balanced mix'],
      why:'Ultra-easy, ultra-clean city-state with world-class hawker food and gardens',
      tradeoff:'Noticeably pricier than the rest of Southeast Asia' } ] },
  { keywords:['mexico','cancun','tulum','oaxaca','cabo','yucatan'], profile:'Mexico & Caribbean', proposals:[
    { cities:['Mexico City','Oaxaca'], english:1, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:1, styles:['Cultural exploration','Balanced mix'],
      why:'Two of the world\'s great food cities, an hour apart by plane',
      tradeoff:'Mexico City\'s altitude takes a day to adjust to' },
    { cities:['Tulum'], english:1, walkable:false, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Relaxation'],
      why:'Caribbean beaches, cenote swims, and Mayan ruins on the Riviera Maya',
      tradeoff:'The beach zone is spread out — bikes, taxis, or a car needed' },
    { cities:['Mexico City'], english:1, walkable:true, bucket:false, access:1, kid:1, pet:0, solo:1, styles:['Cultural exploration'],
      why:'Museums, murals, and taquerías across walkable neighborhoods like Roma and Condesa',
      tradeoff:'Big-city sprawl beyond the core neighborhoods' } ] },
  { keywords:['caribbean','puerto rico','san juan','aruba','jamaica','bahamas','dominican'], profile:'Mexico & Caribbean', proposals:[
    { cities:['San Juan'], english:2, walkable:true, bucket:false, access:1, kid:2, pet:1, solo:1, styles:['Relaxation','Balanced mix'],
      why:'Old-city color, beaches, and rainforest day trips — no passport needed for US travelers',
      tradeoff:'A popular cruise stop, so the old town gets busy at midday' },
    { cities:['Aruba'], english:2, walkable:false, bucket:false, access:1, kid:2, pet:0, solo:1, styles:['Relaxation'],
      why:'Reliably dry, breezy beach weather even in hurricane season',
      tradeoff:'More resort strip than local culture' } ] },
  { keywords:['australia','sydney','melbourne','new zealand','auckland','queenstown'], profile:'Australia & New Zealand', proposals:[
    { cities:['Sydney'], english:2, walkable:true, bucket:true, access:2, kid:2, pet:0, solo:2, styles:['Balanced mix','Adventure'],
      why:'Harbour icons, surf beaches, and coastal walks in one big, easy city',
      tradeoff:'Very long flights from North America and Europe' },
    { cities:['Sydney','Melbourne'], english:2, walkable:true, bucket:false, access:2, kid:1, pet:0, solo:2, styles:['Cultural exploration','Balanced mix'],
      why:'Australia\'s two biggest cities — harbour glamour plus laneway coffee culture',
      tradeoff:'A 1.5-hour flight between them on top of the long haul' },
    { cities:['Queenstown'], english:2, walkable:false, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Adventure'],
      why:'New Zealand\'s adventure capital — bungy, hikes, and alpine lake scenery',
      tradeoff:'Remote — a car helps for Milford Sound and the fjords' } ] },
  { keywords:['texas','austin','dallas','houston','san antonio','arizona','sedona','las vegas','grand canyon'], profile:'US Southwest & Texas', proposals:[
    { cities:['Austin'], english:2, walkable:false, bucket:false, access:1, kid:1, pet:2, solo:1, styles:['Balanced mix'],
      why:'Live music, barbecue, and lake days in Texas\'s most visitable city',
      tradeoff:'Spread out — a car makes it much easier' },
    { cities:['Austin','San Antonio'], english:2, walkable:false, bucket:false, access:1, kid:2, pet:2, solo:1, styles:['Balanced mix','Cultural exploration'],
      why:'Austin\'s music-and-food scene plus the Alamo and River Walk, 80 minutes apart',
      tradeoff:'Best done as a road trip with a rental car' },
    { cities:['Las Vegas','Grand Canyon'], english:2, walkable:false, bucket:true, access:1, kid:1, pet:0, solo:1, styles:['Adventure','Balanced mix'],
      why:'Strip spectacle paired with one of the world\'s great natural wonders',
      tradeoff:'Desert drives and extreme summer heat' } ] },
  { keywords:['europe','european'], profile:'Europe', proposals:[
    { cities:['London','Paris'], english:1, walkable:true, bucket:true, access:1, kid:1, pet:0, solo:1, styles:['Cultural exploration','Balanced mix'],
      why:'Two iconic capitals 2 hours apart by Eurostar — the classic first-Europe combination',
      tradeoff:'Big-city prices in both' },
    { cities:['Rome','Florence'], english:1, walkable:true, bucket:true, access:0, kid:1, pet:0, solo:1, styles:['Cultural exploration'],
      why:'Italy\'s greatest hits — ancient Rome and Renaissance Florence by 90-minute train',
      tradeoff:'Very touristed centers in high season' },
    { cities:['Barcelona'], english:1, walkable:true, bucket:true, access:1, kid:2, pet:0, solo:1, styles:['Balanced mix','Relaxation'],
      why:'Architecture, beaches, and tapas in one compact, sunny city',
      tradeoff:'Heavily touristed center — watch for pickpockets' } ] }
];

// Known city pairs (order-insensitive keyword match). fare = per person;
// base = per rental car. hrs = realistic door-to-door hours for ranking.
var CITY_PAIRS = [
  { a:['austin'], b:['dallas'],
    drive:{ dur:'3h10m', hrs:3.2, base:95, detail:'I-35 N' },
    train:{ label:'Amtrak Texas Eagle', dur:'5h40m', hrs:5.7, fare:22, detail:'One daily departure each way',
      tradeoff:'Cheapest, but slowest — and it sells out on weekends' },
    flight:{ dur:'55m flight · ≈2h30m door-to-door', hrs:2.5, fare:84, detail:'AUS–DAL (Love Field)',
      tradeoff:'Faster door-to-door, pricier' } },
  { a:['austin'], b:['san antonio'],
    drive:{ dur:'1h20m', hrs:1.4, base:55, detail:'I-35 S' },
    train:{ label:'Amtrak Texas Eagle', dur:'2h45m', hrs:2.8, fare:16, detail:'One daily departure each way' } },
  { a:['london'], b:['paris'],
    train:{ label:'Eurostar', dur:'2h16m', hrs:2.3, fare:120, detail:'St Pancras → Gare du Nord' },
    flight:{ dur:'1h20m flight · ≈4h door-to-door', hrs:4, fare:110, detail:'LHR/LGW–CDG' },
    drive:{ dur:'5h45m incl. Channel crossing', hrs:5.8, base:260, detail:'Via LeShuttle, Folkestone–Calais',
      tradeoff:'Rarely worth it — crossing fees plus central-Paris parking' } },
  { a:['london'], b:['edinburgh'],
    train:{ label:'LNER Azuma', dur:'4h20m', hrs:4.4, fare:90, detail:"King's Cross → Waverley" },
    flight:{ dur:'1h25m flight · ≈4h door-to-door', hrs:4, fare:85, detail:'LHR/LGW–EDI' },
    drive:{ dur:'7h30m', hrs:7.5, base:210, detail:'M1/A1 north' } },
  { a:['tokyo'], b:['kyoto'],
    train:{ label:'Shinkansen Nozomi', dur:'2h15m', hrs:2.3, fare:95, detail:'Tokyo Sta. → Kyoto Sta., trains every ~10 min' },
    flight:{ dur:'1h15m flight · ≈4h door-to-door', hrs:4, fare:90, detail:'HND–ITM (Osaka), then train into Kyoto' },
    drive:{ dur:'5h30m', hrs:5.5, base:190, detail:'Tomei/Shin-Tomei expressways',
      tradeoff:'Steep tolls and scarce city parking' } },
  { a:['kyoto'], b:['osaka'],
    train:{ label:'JR Special Rapid', dur:'29m', hrs:0.5, fare:6, detail:'Kyoto Sta. → Osaka Sta., every ~15 min' },
    drive:{ dur:'1h10m', hrs:1.2, base:45, detail:'Meishin Expressway' } },
  { a:['lisbon'], b:['porto'],
    train:{ label:'Alfa Pendular', dur:'2h50m', hrs:2.9, fare:28, detail:'Santa Apolónia → Campanhã' },
    drive:{ dur:'3h00m', hrs:3.1, base:90, detail:'A1 motorway, tolls' },
    flight:{ dur:'55m flight · ≈3h door-to-door', hrs:3, fare:65, detail:'LIS–OPO' } },
  { a:['rome'], b:['florence'],
    train:{ label:'Frecciarossa', dur:'1h32m', hrs:1.6, fare:45, detail:'Termini → Santa Maria Novella' },
    drive:{ dur:'3h00m', hrs:3.1, base:110, detail:'A1 Autostrada',
      tradeoff:'Restricted ZTL driving zones in both historic centers' } },
  { a:['madrid'], b:['seville'],
    train:{ label:'AVE high-speed', dur:'2h30m', hrs:2.5, fare:60, detail:'Atocha → Santa Justa' },
    flight:{ dur:'1h05m flight · ≈3h door-to-door', hrs:3, fare:80, detail:'MAD–SVQ' },
    drive:{ dur:'5h15m', hrs:5.3, base:150, detail:'A-4 south' } },
  { a:['paris'], b:['nice'],
    flight:{ dur:'1h35m flight · ≈4h door-to-door', hrs:4, fare:95, detail:'ORY/CDG–NCE' },
    train:{ label:'TGV InOui', dur:'5h50m', hrs:5.9, fare:70, detail:'Gare de Lyon → Nice-Ville' },
    drive:{ dur:'8h45m', hrs:8.8, base:280, detail:'A6/A7 south' } },
  { a:['dublin'], b:['galway'],
    train:{ label:'Irish Rail', dur:'2h30m', hrs:2.5, fare:25, detail:'Heuston → Galway (Ceannt)' },
    drive:{ dur:'2h30m', hrs:2.6, base:80, detail:'M6 west' } },
  { a:['bangkok'], b:['chiang mai'],
    flight:{ dur:'1h20m flight · ≈3h30m door-to-door', hrs:3.5, fare:45, detail:'BKK/DMK–CNX, frequent departures' },
    train:{ label:'Overnight sleeper train', dur:'13h', hrs:13, fare:30, detail:'Sleeps a hotel night away',
      tradeoff:'Cheapest and saves a lodging night, but most of a day in transit' },
    drive:{ dur:'9h', hrs:9.2, base:160, detail:'Highway 1 north' } },
  { a:['sydney'], b:['melbourne'],
    flight:{ dur:'1h35m flight · ≈4h door-to-door', hrs:4, fare:90, detail:'SYD–MEL, shuttle frequency' },
    train:{ label:'NSW TrainLink XPT', dur:'11h', hrs:11, fare:65, detail:'Central → Southern Cross' },
    drive:{ dur:'9h', hrs:9, base:220, detail:'Hume Highway' } },
  { a:['mexico city'], b:['oaxaca'],
    flight:{ dur:'1h05m flight · ≈3h door-to-door', hrs:3, fare:70, detail:'MEX–OAX' },
    drive:{ dur:'5h30m', hrs:5.6, base:140, detail:'Toll highway 135D' } },
  { a:['athens'], b:['santorini'],
    flight:{ dur:'50m flight · ≈3h door-to-door', hrs:3, fare:90, detail:'ATH–JTR' },
    ferry:{ label:'Blue Star ferry', dur:'7h45m', hrs:7.8, fare:45, detail:'Piraeus → Athinios port',
      tradeoff:'Cheap and scenic, but takes most of a day' } },
  { a:['las vegas'], b:['grand canyon'],
    drive:{ dur:'4h15m', hrs:4.3, base:130, detail:'US-93 → I-40; park entry not included' },
    flight:{ label:'Scenic air transfer', dur:'70m flight · ≈3h door-to-door', hrs:3, fare:240, detail:'LAS–GCN, small aircraft',
      tradeoff:'Spectacular canyon views, premium price' } }
];

// Honest medium-distance assumption for pairs we don't have on file.
var GENERIC_LEG = {
  drive:{ dur:'≈4h30m (estimated)', hrs:4.5, base:120,
    detail:"We don't have this city pair on file — medium distance assumed",
    tradeoff:'Most flexible; time and cost are rough estimates' },
  train:{ label:'Train or intercity bus', dur:'≈5h30m (estimated)', hrs:5.5, fare:35,
    detail:'Service availability varies on this route — estimated',
    tradeoff:'Usually cheapest where a direct service runs — schedules not verified' },
  flight:{ label:'Flight', dur:'≈1h15m flight · ≈3h30m door-to-door (estimated)', hrs:3.5, fare:130,
    detail:'Assumes a direct or one-stop regional flight — estimated',
    tradeoff:'Fastest if a direct route exists; fares are rough estimates' }
};
