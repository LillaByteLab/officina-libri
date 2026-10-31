// Dati trascritti dalle tabelle KDP per kdp.amazon.com, letti il 2026-10-27.
// Questa funzione calcola misure e limiti; non certifica file pronti per KDP.
export const KDP_SOURCES = [
  'https://kdp.amazon.com/en_US/help/topic/GVBQ3CMEQW3W2VL6',
  'https://kdp.amazon.com/en_US/help/topic/G201857950',
  'https://kdp.amazon.com/en_US/help/topic/G201834180',
  'https://kdp.amazon.com/en_US/help/topic/G201953020',
  'https://kdp.amazon.com/en_US/help/topic/GDTKFJPNQCBTMRV6',
  'https://kdp.amazon.com/en_US/help/topic/G200645690',
  'https://kdp.amazon.com/cover-calculator'
];
export const KDP_CHECKED_AT='2026-10-27';
export const KDP_BLEED_MM=3.175;
const sizes = [
  [5,8,828,776,812,828], [5.06,7.81,828,776,812,828],
  [5.25,8,828,776,812,828], [5.5,8.5,828,776,812,828],
  [6,9,828,776,812,828], [6.14,9.21,828,776,812,828],
  [6.69,9.61,828,776,812,828], [7,10,828,776,812,828],
  [7.44,9.69,828,776,812,828], [7.5,9.25,828,776,812,828],
  [8,10,828,776,812,828], [8.25,6,800,750,784,800],
  [8.25,8.25,800,750,784,800], [8.5,8.5,590,550,578,590],
  [8.5,11,590,550,578,590], [8.27,11.69,780,730,764,590]
];
export const PAPERBACK_FORMATS = sizes.map(([widthIn,heightIn,blackWhiteMax,blackCreamMax,blackGroundwoodMax,premiumMax])=>({
  id:`${widthIn}x${heightIn}`,label:`${widthIn} × ${heightIn} in`,widthIn,heightIn,
  blackWhiteMax,blackCreamMax,blackGroundwoodMax,premiumMax,standardAvailable:!(widthIn===8.27&&heightIn===11.69)
}));
export const HARDCOVER_FORMATS = [[5.5,8.5],[6,9],[6.14,9.21],[7,10],[8.25,11]].map(([widthIn,heightIn])=>({id:`${widthIn}x${heightIn}`,label:`${widthIn} × ${heightIn} in`,widthIn,heightIn}));
// Separate regional catalog. Metric dimensions follow the values published by KDP Japan.
export const JAPAN_CHECKED_AT='2026-10-31';
export const JAPAN_FORMATS=[[103,182],[105,173],[112,174],[127,188],[128,182],[148,210],[152,218],[152,227],[182,257],[182,206],[210,257],[210,297]].map(([w,h])=>({id:`jp-${w}x${h}`,label:`${w} × ${h} mm · Giappone`,widthIn:w/25.4,heightIn:h/25.4,blackWhiteMax:w===210?780:828,blackCreamMax:w===210?730:776,blackGroundwoodMax:w===210?764:812,premiumMax:w===210?780:828,standardAvailable:h!==297}));
const round3=n=>Math.round(n*1000)/1000;
const mm=n=>round3(n*25.4);
export function defaultKdp(kind='romanzo') {return {binding:'paperback',formatId:kind==='albo'?'8.5x8.5':'6x9',ink:kind==='albo'?'premium':'black',paper:'white',bleed:false};}
export function planKdp({market='standard',binding='paperback',formatId='8.5x8.5',customWidthIn,customHeightIn,ink='premium',paper='white',bleed=false,pageCount=70}={}) {
  if(!['paperback','hardcover'].includes(binding)||!['black','standard','premium'].includes(ink)||!['white','cream','groundwood'].includes(paper))throw new Error('Opzioni KDP non riconosciute.');
  if(!['standard','jp'].includes(market))throw new Error('Catalogo KDP non riconosciuto.');if(market==='jp'&&binding==='hardcover')throw new Error('Il catalogo KDP Giappone non comprende la copertina rigida.');
  const formats=market==='jp'?JAPAN_FORMATS:binding==='hardcover'?HARDCOVER_FORMATS:PAPERBACK_FORMATS;
  const isCustom=formatId==='custom';
  const format=isCustom?{id:'custom',label:`Personalizzato ${customWidthIn??0} × ${customHeightIn??0} in`,widthIn:customWidthIn,heightIn:customHeightIn}:formats.find(f=>f.id===formatId);
  if(!format)throw new Error('Formato KDP non presente nella tabella selezionata.');
  if(!Number.isFinite(format.widthIn)||!Number.isFinite(format.heightIn))throw new Error('Inserisci entrambe le dimensioni personalizzate in pollici.');
  if(!Number.isInteger(pageCount)||pageCount<0)throw new Error('Conteggio pagine non valido.');
  const issues=[],settingsErrors=[],submissionErrors=[];
  let minimum=binding==='hardcover'?75:ink==='standard'?72:24;
  let maximum=0;
  if(isCustom) {
    if(binding==='hardcover')settingsErrors.push('Le misure personalizzate sono previste per la brossura, non per il rigido.');
    if(format.widthIn<4||format.widthIn>8.5||format.heightIn<6||format.heightIn>11.69)settingsErrors.push('La misura personalizzata deve rientrare tra 4–8,5 in di larghezza e 6–11,69 in di altezza.');
    if(ink!=='black'&&paper!=='white')settingsErrors.push('Combinazione colore e carta non disponibile.');
    maximum=null;
    issues.push('Il limite massimo di pagine per questa misura personalizzata va verificato nel calcolatore KDP.');
  } else if(binding==='hardcover') {
    if(ink==='standard'||paper==='groundwood'||(ink!=='black'&&paper!=='white'))settingsErrors.push('Combinazione stampa/carta non disponibile per il rigido.');
    else maximum=550;
  } else if(ink==='black') {
    maximum=paper==='white'?format.blackWhiteMax:paper==='cream'?format.blackCreamMax:paper==='groundwood'?format.blackGroundwoodMax:0;
  } else if(ink==='standard') {
    maximum=paper==='white'&&format.standardAvailable?600:0;
  } else if(ink==='premium') {
    maximum=paper==='white'?format.premiumMax:0;
  }
  if(maximum===0&&!settingsErrors.length)settingsErrors.push('Combinazione formato, stampa e carta non disponibile nella tabella KDP.');
  const countedPages=pageCount%2?pageCount+1:pageCount;
  if(pageCount%2)issues.push('KDP conta il manoscritto cartaceo arrotondando al numero pari successivo.');
  if(countedPages<minimum||(maximum&&countedPages>maximum))submissionErrors.push(`Pagine fuori intervallo: ${minimum}–${maximum??'massimo da verificare'} per questa combinazione.`);
  issues.push(...settingsErrors,...submissionErrors);
  const outsideIn=.125, coverBleedIn=.125;
  const interiorIn=[format.widthIn+(bleed?outsideIn:0),format.heightIn+(bleed?2*outsideIn:0)];
  // La guida specifica della copertina distingue standard da premium.
  const spineFactor=ink==='black'?(paper==='cream'?.0025:paper==='groundwood'?.00235:.002252):ink==='standard'?.002252:.002347;
  const spineIn=binding==='paperback'?countedPages*spineFactor:null;
  const coverIn=spineIn===null?null:[2*format.widthIn+spineIn+2*coverBleedIn,format.heightIn+2*coverBleedIn];
  const gutterMm=countedPages<=150?9.6:countedPages<=300?12.7:countedPages<=500?15.9:countedPages<=700?19.1:22.3;
  return {format,market,binding,ink,paper,bleed,pageCount,countedPages,minimum,maximum,issues,settingsErrors,submissionErrors,
    trimMm:[mm(format.widthIn),mm(format.heightIn)],interiorMm:interiorIn.map(mm),
    spineMm:spineIn===null?null:mm(spineIn),spineFactorIn:binding==='paperback'?spineFactor:null,spineTextAllowed:countedPages>=80,coverMm:coverIn?.map(mm)??null,
    minimumMarginsMm:{inside:gutterMm,outside:bleed?9.6:6.4},
    safeFromTrimMm:{inside:gutterMm,outside:bleed?9.6-KDP_BLEED_MM:6.4,top:bleed?9.6-KDP_BLEED_MM:6.4,bottom:bleed?9.6-KDP_BLEED_MM:6.4},
    notes:[...(binding==='hardcover'?['Per la copertina rigida serve il template KDP con risvolti e cerniere.']:['La copertina richiede sempre 3,175 mm di abbondanza per lato.','Il dorso è una stima geometrica: verifica con il template KDP.']),...(isCustom?['Per una misura personalizzata, il massimo di pagine e le combinazioni di stampa vanno verificati nel calcolatore KDP.']:[])]};
}
export function applyKdp(project,settings) {
  const p=structuredClone(project),plan=planKdp({...settings,pageCount:p.pages.length});
  if(plan.settingsErrors.length)throw new Error(plan.settingsErrors.join('\n'));
  p.kdp={...settings};p.geometry={...p.geometry,trimWidthMm:plan.format.widthIn*25.4,trimHeightMm:plan.format.heightIn*25.4,bleedMm:settings.bleed?KDP_BLEED_MM:0,bleedMode:'kdp'};
  return p;
}
export function configurationKey(project) {
  if(!project.kdp)throw new Error('Applica prima un formato KDP al progetto.');
  const p=planKdp({...project.kdp,pageCount:project.pages.length});
  return JSON.stringify([p.binding,p.format.widthIn,p.format.heightIn,p.ink,p.paper,p.countedPages,'LTR']);
}
export const KDP_OUTPUT_RULES={
  interior:{format:'PDF a pagine singole; obbligatorio con smarginatura',maxBytes:650000000,minFontPt:7,minImagePpi:300,flattenTransparency:true,marks:false},
  cover:{format:'Un PDF di una pagina: quarta + dorso + prima',maxBytes:650000000,recommendedBytes:40000000,bleedMm:3.175,textInsetFromTrimMm:3.175,spineTextInsetMm:1.5875,minImagePpi:300,flattenTransparency:true},
  kindle:{formats:['JPEG','TIFF'],idealPixels:[1600,2560],minimumPixels:[625,1000],maxSidePixels:10000,maxBytes:50000000,color:'RGB',printBleed:false}
};
