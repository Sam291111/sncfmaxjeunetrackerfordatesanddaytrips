export const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const stationNameKey = value => clean(value).replace(/\bst\b/g,'saint').replace(/\bste\b/g,'sainte');
export const matchesSelectedStop = (stop,query) => {const name=stationNameKey(stop),selected=stationNameKey(query);return name===selected||selected.split(' ').length>1&&name.startsWith(`${selected} `);};
export const isParisAllStations = value => /^(?:paris all stations|paris toutes les gares)$/.test(clean(value));
export const isLyonAllStations = value => /^(?:lyon all stations|lyon toutes les gares)$/.test(clean(value));
const stationIataAliases = new Map([
  ['paris gare de lyon','FRPLY'],['paris gare de lyon hall 1 2','FRPLY'],['paris lyon','FRPLY'],
  ['paris gare du nord','FRPNO'],['paris nord','FRPNO'],
  ['paris gare de l est','FRPST'],['paris est','FRPST'],
  ['paris montparnasse','FRPMO'],['paris montparnasse 1 et 2','FRPMO'],['paris montparnasse hall 1 2','FRPMO'],
  ['paris montparnasse 3 vaugirard','FRMPV'],['paris montparnasse vaugirard','FRMPV'],
  ['paris saint lazare','FRPSL'],['paris saint lazare noctilien','FRPSL'],
  ['paris austerlitz','FRPAZ'],['paris bercy','FRPBE'],['paris bercy bourg pays d auv','FRPBE'],
  ['lyon part dieu','FRLPD'],['lyon perrache','FRLPE'],['lyon saint exupery','FRJDQ'],['lyon saint exupery tgv','FRJDQ'],['lyon st exupery','FRJDQ'],['lyon st exupery tgv','FRJDQ'],
  ['lille europe','FRLLE'],['lille flandres','FRADJ'],
  ['avignon centre','FRAES'],['avignon tgv','FRAVG'],
  ['aix en provence tgv','FRAIE'],['valence ville','FRVAF'],
  ['valence tgv rhone alpes sud','FRVLA'],['valence tgv auvergne rhone alpes','FRVLA'],
  ['montpellier saint roch','FRMPL'],['montpellier saint roch occitanie','FRMPL'],
  ['massy tgv','FRDJU'],['massy palaiseau','FRMPU'],
  ['les aubrais','FRLAB'],['aeroport charles de gaulle 2 tgv','FRMLW'],['roissy cdg 2 tgv','FRMLW'],
  ['dijon','FRABA'],['dijon ville','FRABA'],['dole','FRACE'],['dole ville','FRACE'],
  ['metz','FRADE'],['metz ville','FRADE'],['mulhouse','FRAEK'],['mulhouse ville','FRAEK'],
  ['macon','FRHGU'],['macon ville','FRHGU'],['la rochelle','FRLRH'],['la rochelle ville','FRLRH'],
  ['lerouville','FRPFJ'],['lerouville centre','FRPFJ'],
  ['port vendres','FRXPV'],['port vendres ville','FRXPV'],
  ['saint maixent l ecole','FREJC'],['saint gaudens','FRFPH'],['andorre l hospitalet','FRFQG'],
  ['saint christophe','FRFST'],['caussade','FRFTA'],['saint vincent de tyrosse','FRGHA'],
  ['brassac les mines sainte florine','FRHLE'],['mont dauphin guillestre','FRIGZ'],
  ['saint flour chaudes aigues','FRIMW'],['campagnac saint geniez','FRINJ'],['saint brieuc','FRSBK'],
  ['saint denis pres martel','FRSDM'],['saint nazaire','FRSNR'],['bellegarde','FRXBF'],
  ['le creusot tgv','FRXCC'],['montelimar','FRXMK'],['saint malo','FRXSB'],
  ['saint pierre des corps','FRXSH'],['saint raphael valescure','FRXSK'],['saint die des vosges','FRXTD'],
  ['barcelone sants','ESBST'],['munich','DEBEG'],['francfort sur le main','DEFRH'],
  ['oulx cesana claviere sestriere','ITOCS'],['oux cesana clav sestriere','ITOCS'],
  ['turin porta susa','ITTRS'],['torino porta susa','ITTRS'],
  ['ringsheim','DERSH'],['sarrebruck','DESBK'],['boulogne sur mer','FRAEB'],
  ['zurich hb','CHAJD']
]);
export function stationIataCode(value) { return stationIataAliases.get(clean(value)) || null; }
export const endpointIdentity = value => stationIataCode(value) || stationKey(value);
const iataStationNames = new Map([
  ['FRPLY','Paris Gare de Lyon'],['FRPNO','Paris Gare du Nord'],['FRPST','Paris Est'],
  ['FRPMO','Paris Montparnasse Hall 1 - 2'],['FRMPV','Paris Montparnasse 3 - Vaugirard'],
  ['FRPSL','Paris Saint-Lazare'],['FRPAZ','Paris Austerlitz'],['FRPBE','Paris Bercy'],
  ['FRLPD','Lyon Part Dieu'],['FRLPE','Lyon Perrache'],['FRJDQ','Lyon Saint-Exupéry TGV'],
  ['FRABA','Dijon'],['FRACE','Dole'],['FRADE','Metz'],['FRAEK','Mulhouse'],
  ['FRHGU','Mâcon'],['FRLRH','La Rochelle'],['FRPFJ','Lérouville'],['FRXPV','Port-Vendres'],
  ['FRLLE','Lille Europe'],['FRADJ','Lille Flandres'],
  ['FRAES','Avignon Centre'],['FRAVG','Avignon TGV'],['FRAIE','Aix-en-Provence TGV'],
  ['FRVAF','Valence Ville'],['FRVLA','Valence TGV Rhône-Alpes Sud'],
  ['FRMPL','Montpellier Saint-Roch'],['FRDJU','Massy TGV'],['FRMPU','Massy-Palaiseau'],
  ['FRLAB','Les Aubrais'],['FRMLW','Aéroport Charles de Gaulle 2 TGV'],
  ['FREJC',"Saint-Maixent-L'École"],['FRFPH','Saint-Gaudens'],['FRFQG',"Andorre l'Hospitalet"],
  ['FRFST','Saint-Christophe'],['FRFTA','Caussade'],['FRGHA','Saint-Vincent-de-Tyrosse'],
  ['FRHLE','Brassac-les-Mines - Sainte-Florine'],['FRIGZ','Mont-Dauphin - Guillestre'],
  ['FRIMW','Saint-Flour - Chaudes-Aigues'],['FRINJ','Campagnac - Saint-Geniez'],['FRSBK','Saint-Brieuc'],
  ['FRSDM','Saint-Denis-Près-Martel'],['FRSNR','Saint-Nazaire'],['FRXBF','Bellegarde'],
  ['FRXCC','Le Creusot-TGV'],['FRXMK','Montélimar'],['FRXSB','Saint-Malo'],
  ['FRXSH','Saint-Pierre-des-Corps'],['FRXSK','Saint-Raphaël Valescure'],['FRXTD','Saint-Dié-des-Vosges'],
  ['ESBST','Barcelone-Sants'],['DEBEG','Munich'],['DEFRH','Francfort sur le Main'],
  ['DERSH','Ringsheim'],['DESBK','Sarrebruck'],['FRAEB','Boulogne sur Mer'],['CHAJD','Zürich HB'],
  ['ITOCS','OULX CESANA CLAVIERE SESTRIERE'],['ITTRS','Turin Porta Susa']
]);
export const stationNameFromIata = (code,fallback) => iataStationNames.get(String(code||'').toUpperCase()) || fallback;
const distinctStationNames = new Set(['avignon centre','avignon tgv','aix en provence','aix en provence tgv','valence ville','valence tgv rhone alpes sud','le creusot','le creusot tgv']);
const stationIataCoordinates = new Map([['CHAJD',{lat:47.3782,lon:8.5402}]]);
export function coordinatesForStation(value) { const code=stationIataCode(value);return code?stationIataCoordinates.get(code)||null:null; }
export function coordinatesForIataCode(code) { return stationIataCoordinates.get(String(code||'').toUpperCase())||null; }
export function matchesAvailabilityStation(record, query, side) {
  if (isParisAllStations(query)) return stationKey(side==='origin'?(record.origine||record.Origine):(record.destination||record.Destination))==='paris';
  const code=stationIataCode(query), codeField=side==='origin'?(record.origine_iata||record.Origine_IATA):(record.destination_iata||record.Destination_IATA);
  const label=side==='origin'?(record.origine||record.Origine):(record.destination||record.Destination);
  if (isLyonAllStations(query)) return codeField ? ['FRLPD','FRLPE','FRJDQ'].includes(String(codeField).toUpperCase()) : stationKey(label)==='lyon';
  if (code&&codeField) return String(codeField).toUpperCase()===code;
  return stationKey(label)===stationKey(query);
}
export function stationKey(value) {
  const name=clean(value);
  if(distinctStationNames.has(name))return name;
  if(isParisAllStations(name)||/^paris (?:est|nord|(?:gare )?de lyon|(?:gare du )?nord|(?:gare de l )?est|(?:gare )?montparnasse|(?:gare )?austerlitz|(?:gare )?bercy|(?:gare )?saint lazare)/.test(name))return 'paris';
  if(isLyonAllStations(name)||/^lyon (?:st|saint) exupery(?: tgv)?$/.test(name))return 'lyon';
  return name.replace(/\bintramuros\b/g, '').replace(/\b(gare du nord|gare de l est|gare de lyon|gare montparnasse|gare saint lazare|gare d austerlitz|gare de bercy|part dieu|perrache|saint charles|st charles|saint roch|st roch|saint jean|st jean|matabiau|centre|ville|tgv|gare)\b/g, '').replace(/\s+/g, ' ').trim();
}
export const stationNodeKey = value => {
  if (isParisAllStations(value)) return 'group:paris';
  if (isLyonAllStations(value)) return 'group:lyon';
  const code = stationIataCode(value);
  return code ? `iata:${code}` : `name:${stationKey(value)}`;
};
// Keep each terminal distinct for search endpoints, but allow Paris station
// changes through the graph when the connection-time rule permits them.
export const transferNodeKey = value => stationKey(value) === 'paris' ? 'transfer:paris' : stationNodeKey(value);
export function stationMatchesSelection(selection, station) {
  if (isParisAllStations(selection)) return stationKey(station) === 'paris';
  if (isLyonAllStations(selection)) return stationKey(station) === 'lyon';
  const code = stationIataCode(selection);
  return code ? stationIataCode(station) === code : stationKey(selection) === stationKey(station);
}
