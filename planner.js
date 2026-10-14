import { addServiceDays, formatParisTime, parisDateKey, parisEndOfDay, parisStartOfDay, serviceTimeToDate } from './time.js';

import { connectionProduct, classifyOuigo, isMaxTgvOrIntercites, isRail, isTimetableConnection, routeName } from './products.js';
import { clean, coordinatesForIataCode, coordinatesForStation, endpointIdentity, isLyonAllStations, isParisAllStations, matchesAvailabilityStation, matchesSelectedStop, stationIataCode, stationKey, stationMatchesSelection, stationNameFromIata, stationNameKey, stationNodeKey, transferNodeKey } from './stations.js';
export { clean, coordinatesForStation, isLyonAllStations, isParisAllStations, matchesAvailabilityStation, stationIataCode, stationKey, stationMatchesSelection } from './stations.js';
const minutes = value => { const [h,m] = String(value || '').split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
const localDateString = (date, days=0) => addServiceDays(date, days);
const atTime = (date, time) => serviceTimeToDate(date, time);
export function normalizeMax(record) {
  const date=record.date || record.DATE, origin=record.origine || record.Origine, destination=record.destination || record.Destination;
  const originIata=record.origine_iata||record.Origine_IATA,destinationIata=record.destination_iata||record.Destination_IATA;
  const dep=record.heure_depart || record.Heure_depart, arr=record.heure_arrivee || record.Heure_arrivee;
  if(!date||!origin||!destination||!dep||!arr)return null;
  const from=atTime(date,dep);let to=atTime(date,arr);if(from&&to&&to<from)to=atTime(localDateString(date,1),arr);
  const shownOrigin=stationNameFromIata(originIata,origin),shownDestination=stationNameFromIata(destinationIata,destination);
  const nightTrain=/\bIC\s*NUIT\b|INTERCIT[EÉ]S\s+DE\s+NUIT/i.test(`${record.axe||record.AXE||''} ${record.entity||record.ENTITY||''}`);
  const available=String(record.od_happy_card||record.OD_HAPPY_CARD||'').toUpperCase()==='OUI';
  return {id:`${record.train_no||record.TRAIN_NO}-${date}-${clean(shownOrigin)}-${clean(shownDestination)}`,date,train:String(record.train_no||record.TRAIN_NO||''),origin:shownOrigin,destination:shownDestination,originIata,destinationIata,dep,arr,from,to,available,type:nightTrain?'MAX Intercités de nuit':'MAX TGV / Intercités',nightTrain,paid:false,maxAvailable:available,tripId:`max-${record.train_no||record.TRAIN_NO}-${date}`};
}
function dateForGtfs(date,time){return serviceTimeToDate(date,time);}
function activeServices(tables,date){const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${date}T00:00:00.000Z`).getUTCDay()],ymd=date.replaceAll('-',''),active=new Set();for(const c of tables.calendar||[])if(ymd>=c.start_date&&ymd<=c.end_date&&c[weekday]==='1')active.add(c.service_id);for(const c of tables.calendarDates||[])if(c.date===ymd){if(c.exception_type==='1')active.add(c.service_id);else active.delete(c.service_id);}return active;}
const connectionRicsForTrip=trip=>String(trip?.trip_id||'').match(/F(\d{4})_/)?.[1]||'';
// SNCF's GTFS trip IDs encode the OUIGO operator even when the route label is
// generic. The current feed uses 7xxx numbers for OUIGO Grande Vitesse and
// 4xxx numbers for OUIGO Train Classique. MAX applies only to Grande Vitesse.
function maxSignature(date,train,origin,destination){return `${date}|${String(train||'').trim()}|${endpointIdentity(origin)}|${endpointIdentity(destination)}`;}
function minChange(from,to){const a=clean(from),b=clean(to),citywideParis=name=>name==='paris'||name==='paris centre'||name.includes('intramuros');if(citywideParis(a)&&citywideParis(b))return 45;if(a===b||stationIataCode(from)&&stationIataCode(from)===stationIataCode(to))return 12;if(stationKey(from)===stationKey(to))return a.includes('paris')&&b.includes('paris')?90:45;if(a.includes('paris')&&b.includes('paris'))return 90;return 45;}
export const minimumConnectionMinutes = minChange;
const uicCode = value => {
  const digits=String(value||'').match(/(\d{7,8})$/)?.[1]||'';
  return digits.length===8?digits.slice(0,7):digits;
};
const stationRulesKey = (arrival,departure) => `${arrival||''}>${departure||''}`;
export function buildConnectionTimeRules({connectionRows=[],trainRows=[],stationRows=[],stops=[]}={}){
  const stationByName=new Map(),stationByIata=new Map(),stationByUic=new Map();
  const addName=(map,name,code)=>{const key=stationNameKey(name);if(!key||!code)return;if(!map.has(key))map.set(key,new Set());map.get(key).add(code);};
  for(const row of stationRows){const code=uicCode(row.CODE_UIC);if(!code)continue;stationByUic.set(code,{code,locality:uicCode(row.LOCALITY_UIC)});addName(stationByName,row.DESCRIPTION,code);}
  for(const stop of stops){if(stop.parent_station||stop.location_type&&stop.location_type!=='1')continue;const code=uicCode(stop.stop_id);if(!code)continue;stationByUic.set(code,{code,locality:stationByUic.get(code)?.locality||''});addName(stationByName,stop.stop_name,code);const iata=stationIataCode(stop.stop_name);if(iata){if(!stationByIata.has(iata))stationByIata.set(iata,new Set());stationByIata.get(iata).add(code);}}
  const connectionByPair=new Map();for(const row of connectionRows){const key=stationRulesKey(uicCode(row.ARRIVAL_STATION_UIC),uicCode(row.DEPARTURE_STATION_UIC));if(!connectionByPair.has(key))connectionByPair.set(key,[]);connectionByPair.get(key).push(row);}
  const trainByPair=new Map();for(const row of trainRows){const key=`${stationRulesKey(uicCode(row.ARRIVAL_STATION_UIC),uicCode(row.DEPARTURE_STATION_UIC))}|${String(row.ARRIVAL_TRAIN||'').trim()}|${String(row.DEPARTURE_TRAIN||'').trim()}`;if(!trainByPair.has(key))trainByPair.set(key,[]);trainByPair.get(key).push(row);}
  return{stationByName,stationByIata,stationByUic,connectionByPair,trainByPair};
}
function stationUic(name,rules){const iata=stationIataCode(name),iataCodes=iata&&rules?.stationByIata?.get(iata);if(iataCodes?.size===1)return[...iataCodes][0];const codes=rules?.stationByName?.get(stationNameKey(name));return codes?.size===1?[...codes][0]:null;}
function ruleCondition(expected,actual){const value=String(expected||'').trim().toUpperCase();return !value||value==='ALL'||value===String(actual||'').trim().toUpperCase();}
function currentDay(date){return parisDateKey(date instanceof Date?date:new Date(date));}
function validRuleDate(value){const [day,month,year]=String(value||'').split('/').map(Number);return day&&month&&year?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:'';}
function sncfConnectionRule(previous,next,rules){
  const arrival=previous.destinationUic||stationUic(previous.destination,rules),departure=next.originUic||stationUic(next.origin,rules);if(!arrival||!departure)return{minutes:5,forbidden:false,source:'SNCF default'};
  const travelDate=currentDay(next.from||next.date||new Date()),trainKey=`${stationRulesKey(arrival,departure)}|${String(previous.train||'').trim()}|${String(next.train||'').trim()}`;
  const specific=(rules?.trainByPair?.get(trainKey)||[]).filter(row=>{const start=validRuleDate(row.START_DATE),end=validRuleDate(row.END_DATE);return(!start||travelDate>=start)&&(!end||travelDate<=end);}).sort((a,b)=>Number(a.MIN_DELAY)===Number(b.MIN_DELAY)?0:Number(a.MIN_DELAY)===-1?-1:Number(b.MIN_DELAY)===-1?1:Number(b.MIN_DELAY)-Number(a.MIN_DELAY));
  if(specific.length){const mins=Number(specific[0].MIN_DELAY);return{minutes:Math.max(0,mins),forbidden:mins<0,source:'SNCF train rule'};}
  const arrivalType=previous.connectionType||'',departureType=next.connectionType||'',arrivalRics=previous.connectionRics||'',departureRics=next.connectionRics||'',arrivalMode=previous.connectionMode||'F',departureMode=next.connectionMode||'F';
  const candidates=(rules?.connectionByPair?.get(stationRulesKey(arrival,departure))||[]).filter(row=>ruleCondition(row.ARRIVAL_MODE,arrivalMode)&&ruleCondition(row.DEPARTURE_MODE,departureMode)&&ruleCondition(row.ARRIVAL_RICS,arrivalRics)&&ruleCondition(row.DEPARTURE_RICS,departureRics)&&ruleCondition(row.ARRIVAL_CONNECTION_TYPE,arrivalType)&&ruleCondition(row.DEPARTURE_CONNECTION_TYPE,departureType));
  candidates.sort((a,b)=>{const specificity=row=>['ARRIVAL_MODE','DEPARTURE_MODE','ARRIVAL_RICS','DEPARTURE_RICS','ARRIVAL_CONNECTION_TYPE','DEPARTURE_CONNECTION_TYPE'].reduce((n,key)=>n+(row[key]&&String(row[key]).toUpperCase()!=='ALL'?1:0),0),blocked=row=>Number(row.MIN_DELAY)===-1;return specificity(b)-specificity(a)||Number(blocked(b))-Number(blocked(a))||Number(b.MIN_DELAY)-Number(a.MIN_DELAY);});
  if(candidates.length){const mins=Number(candidates[0].MIN_DELAY);return{minutes:Math.max(0,mins),forbidden:mins<0,source:'SNCF station rule'};}
  return{minutes:5,forbidden:false,source:'SNCF default'};
}
function connectionMinimum(previous,next,options={}){
  const settings=options.connectionSettings;if(!settings)return{minutes:minChange(previous.destination,next.origin),forbidden:false};if(settings.mode==='none')return{minutes:0,forbidden:false,source:'Disabled'};
  const rule=sncfConnectionRule(previous,next,settings.rules),fallbackFloor=rule.source==='SNCF default'?minChange(previous.destination,next.origin):rule.minutes;return{...rule,minutes:settings.mode==='manual'?Number(settings.minimumMinutes):Math.max(rule.minutes,fallbackFloor)};
}
function connectionGapAllowed(previous,next,options={},gap=(next.from-previous.to)/60000){
  const minimum=connectionMinimum(previous,next,options);if(minimum.forbidden||gap<minimum.minutes)return false;
  const maximum=options.connectionSettings?.maximumMinutes==null?null:Number(options.connectionSettings.maximumMinutes);
  return maximum==null||gap<=maximum;
}
export function makeJourneyLegs(tables,startDate,endDate,maxRecords,searchStations=[],connectionRules=null){
  const normalizedRecords=maxRecords.map(normalizeMax).filter(Boolean),source=stationKey(searchStations[0]),target=stationKey(searchStations[1]),family=value=>stationKey(value).split(' ')[0],sourceFamily=family(searchStations[0]),targetFamily=family(searchStations[1]),forward=new Map(),reverse=new Map(),nodeKeys=new Set();
  for(const x of normalizedRecords){const a=stationKey(x.origin),b=stationKey(x.destination);nodeKeys.add(a);nodeKeys.add(b);if(!forward.has(a))forward.set(a,new Set());if(!reverse.has(b))reverse.set(b,new Set());forward.get(a).add(b);reverse.get(b).add(a);}
  const reach=(graph,start,maxDepth)=>{const seen=new Set([start]),queue=[[start,0]];for(let i=0;i<queue.length;i++){const [node,depth]=queue[i];if(depth>=maxDepth)continue;for(const next of graph.get(node)||[])if(!seen.has(next)){seen.add(next);queue.push([next,depth+1]);}}return seen;};
  const sourceNodes=new Set([source,...[...nodeKeys].filter(node=>family(node)===sourceFamily)]),targetNodes=new Set([target,...[...nodeKeys].filter(node=>family(node)===targetFamily)]),fromSource=new Set(),toTarget=new Set();for(const node of sourceNodes)for(const x of reach(forward,node,4))fromSource.add(x);for(const node of targetNodes)for(const x of reach(reverse,node,4))toTarget.add(x);const relevant=new Set([...fromSource].filter(node=>toTarget.has(node)));for(const node of sourceNodes)relevant.add(node);for(const node of targetNodes)relevant.add(node);
  let maxLegs=normalizedRecords.filter(x=>x.available&&x.from&&x.to&&stationKey(x.origin)!==stationKey(x.destination)&&relevant.has(stationKey(x.origin))&&relevant.has(stationKey(x.destination)));
  const maxByKey=new Map(normalizedRecords.map(x=>[maxSignature(x.date,x.train,x.origin,x.destination),x]));
  const availabilityByJourney=new Map(normalizedRecords.map(x=>[`${x.date}|${endpointIdentity(x.origin)}|${endpointIdentity(x.destination)}|${x.dep}|${x.arr}`,x]));
  const {stopById,routeById,tripById,tripsByTrain}=indexesForTables(tables),byTrip=indexStopTimesByTrip(tables.stopTimes||[]);
  const activeByDate=new Map(),selectedNames=[searchStations[0],searchStations[1]].map(stationNameKey),refineEndpoint=(leg,endpoint)=>{
    const isOrigin=endpoint===0,query=searchStations[endpoint],recordName=isOrigin?leg.origin:leg.destination;
    if(!query||isParisAllStations(query)||isLyonAllStations(query)||stationKey(query)!==stationKey(recordName)||clean(query)===clean(recordName))return leg;
    const selectedIata=stationIataCode(query),recordIata=isOrigin?leg.originIata:leg.destinationIata;
    if(selectedIata&&recordIata&&selectedIata!==recordIata)return null;
    let active=activeByDate.get(leg.date);if(!active){active=activeServices(tables,leg.date);activeByDate.set(leg.date,active);}
    const scheduled=[];
    for(const trip of tripsByTrain.get(leg.train)||[]){if(!active.has(trip.service_id))continue;for(const row of byTrip.get(trip.trip_id)||[]){const stop=stopById.get(row.stop_id);if(stop&&matchesSelectedStop(stop.stop_name,query)){const time=dateForGtfs(leg.date,row[isOrigin?'departure_time':'arrival_time']||row[isOrigin?'arrival_time':'departure_time']);if(time)scheduled.push(time);}}}
    // Do not borrow availability from a city-level or neighboring station if
    // the timetable cannot confirm the selected station for this train.
    if(!scheduled.length)return null;
    const reference=isOrigin?leg.from:leg.to,chosen=scheduled.sort((a,b)=>Math.abs(a-reference)-Math.abs(b-reference))[0];
    if(isOrigin)return {...leg,origin:query,dep:formatTime(chosen),from:chosen};
    return {...leg,destination:query,arr:formatTime(chosen),to:chosen};
  };
  maxLegs=maxLegs.map(leg=>{const from=refineEndpoint(leg,0);return from&&refineEndpoint(from,1);}).filter(leg=>leg&&leg.to>leg.from).map(leg=>{let active=activeByDate.get(leg.date);if(!active){active=activeServices(tables,leg.date);activeByDate.set(leg.date,active);}const candidates=tripsByTrain.get(leg.train)||[],trip=candidates.find(candidate=>active.has(candidate.service_id))||candidates[0],route=routeById.get(trip?.route_id)||{};return{...leg,originUic:stationUic(leg.origin,connectionRules),destinationUic:stationUic(leg.destination,connectionRules),connectionMode:'F',connectionType:connectionProduct(route,trip)|| (leg.nightTrain?'INTERCITES':''),connectionRics:connectionRicsForTrip(trip)};});
  const legs=[...maxLegs], start=new Date(`${startDate}T00:00:00.000Z`), end=new Date(`${endDate}T00:00:00.000Z`);
  for(let day=new Date(start);day<=end;day.setUTCDate(day.getUTCDate()+1)){
    const date=day.toISOString().slice(0,10),active=activeServices(tables,date);
    for(const [tripId,rows] of byTrip){const trip=tripById.get(tripId);if(!trip||!active.has(trip.service_id))continue;const route=routeById.get(trip.route_id)||{};if(!isTimetableConnection(route))continue;
      // Pair generation only needs stations that can participate in a route
      // between the selected endpoints. Keeping irrelevant intermediate stops
      // out of the nested pair loop reduces work without losing the original
      // timetable sequence or travel times between relevant stops.
      const stops=rows.map(row=>({row,stop:stopById.get(row.stop_id)})).filter(x=>{
        if(!x.stop)return false;
        const canonical=x.stop.parent_station?stopById.get(x.stop.parent_station)||x.stop:x.stop;
        return relevant.has(stationKey(canonical.stop_name||x.stop.stop_name));
      });
      for(let i=0;i<stops.length-1;i++)for(let j=i+1;j<stops.length;j++){
        const a=stops[i],b=stops[j];
        // GTFS flag 1 explicitly forbids boarding/alighting at that stop.
        // Other values can describe boarding by arrangement and are not
        // treated as impossible by this timetable-only estimate.
        if(a.row.pickup_type==='1'||b.row.drop_off_type==='1')continue;
        const originStop=a.stop.parent_station?stopById.get(a.stop.parent_station)||a.stop:a.stop,destStop=b.stop.parent_station?stopById.get(b.stop.parent_station)||b.stop:b.stop;
        const origin=originStop.stop_name||a.stop.stop_name,destination=destStop.stop_name||b.stop.stop_name;
        const originKey=stationKey(origin),destinationKey=stationKey(destination);
        if(originKey===destinationKey||!relevant.has(originKey)||!relevant.has(destinationKey))continue;
        const train=String(trip.trip_short_name||trip.trip_headsign||tripId),signature=maxSignature(date,train,origin,destination),match=maxByKey.get(signature),product=classifyOuigo(trip,train),ouigoCandidate=product?.maxStatus==='candidate',ouigoClassic=product?.category==='classique';
        // The availability feed supplies the MAX network graph. Add timetable
        // connections touching either search endpoint for paid first/last legs.
        // OUIGO Grande Vitesse is also admitted between relevant MAX graph
        // nodes, so it can serve as an unverified included-product connection.
        if(!ouigoCandidate&&originKey!==source&&originKey!==target&&destinationKey!==source&&destinationKey!==target)continue;
        const originSelectedIata=stationIataCode(searchStations[0]),destinationSelectedIata=stationIataCode(searchStations[1]);
        if(originSelectedIata&&originKey===source&&stationIataCode(origin)!==originSelectedIata)continue;
        if(destinationSelectedIata&&destinationKey===target&&stationIataCode(destination)!==destinationSelectedIata)continue;
        const from=dateForGtfs(date,a.row.departure_time||a.row.arrival_time),to=dateForGtfs(date,b.row.arrival_time||b.row.departure_time);if(!from||!to||to<=from)continue;
        const availabilityMatch=availabilityByJourney.get(`${date}|${endpointIdentity(origin)}|${endpointIdentity(destination)}|${formatTime(from)}|${formatTime(to)}`);
        const listedMaxAvailable=!product&&isMaxTgvOrIntercites(route)&&(match?.available||availabilityMatch?.available);
        if(listedMaxAvailable)continue;
        const type=ouigoCandidate?'OUIGO Grande Vitesse (MAX may apply)':ouigoClassic?'OUIGO Train Classique (not MAX-eligible)':product?'OUIGO service (MAX eligibility unknown)':routeName(route),paid=!ouigoCandidate&&!listedMaxAvailable;
        legs.push({id:`${tripId}-${date}-${i}-${j}`,tripId,train,origin,destination,dep:formatTime(from),arr:formatTime(to),from,to,type,paid,maxAvailable:false,maxEligibilityUnknown:ouigoCandidate,originUic:uicCode(originStop.stop_id),destinationUic:uicCode(destStop.stop_id),connectionMode:'F',connectionType:connectionProduct(route,trip),connectionRics:connectionRicsForTrip(trip)});
      }
    }
  }
  return legs;
}
const timetableIndexesCache=new WeakMap(),stopTimesByTripCache=new WeakMap();
function indexesForTables(tables){
  let cached=timetableIndexesCache.get(tables);if(cached)return cached;
  const stopById=new Map((tables.stops||[]).map(stop=>[stop.stop_id,stop])),routeById=new Map((tables.routes||[]).map(route=>[route.route_id,route])),tripById=new Map((tables.trips||[]).map(trip=>[trip.trip_id,trip])),tripsByTrain=new Map();
  for(const trip of tables.trips||[]){if(!isRail(routeById.get(trip.route_id)||{}))continue;const train=String(trip.trip_short_name||trip.trip_headsign||'');if(!train)continue;if(!tripsByTrain.has(train))tripsByTrain.set(train,[]);tripsByTrain.get(train).push(trip);}
  cached={stopById,routeById,tripById,tripsByTrain};timetableIndexesCache.set(tables,cached);return cached;
}
function indexStopTimesByTrip(stopTimes){
  let byTrip=stopTimesByTripCache.get(stopTimes);if(byTrip)return byTrip;
  byTrip=new Map();for(const row of stopTimes){if(!byTrip.has(row.trip_id))byTrip.set(row.trip_id,[]);byTrip.get(row.trip_id).push(row);}for(const rows of byTrip.values())rows.sort((a,b)=>Number(a.stop_sequence)-Number(b.stop_sequence));stopTimesByTripCache.set(stopTimes,byTrip);return byTrip;
}
function formatTime(d){return formatParisTime(d);}
const DEFAULT_ROUTE_SEARCH_LIMITS=Object.freeze({expanded:50000,frontier:15000,returnExpanded:12000,returnFrontier:5000});
function routeSearchDiagnostics(limits={}){const configured={...DEFAULT_ROUTE_SEARCH_LIMITS,...limits};for(const key of Object.keys(configured))if(configured[key]===Infinity)configured[key]=null;return{truncated:false,expanded:0,returnExpanded:0,frontierPeak:0,frontierCandidatesPeak:0,returnFrontierPeak:0,returnFrontierCandidatesPeak:0,returnSearches:0,returnExpansionLimitedSearches:0,returnExpansionIncompleteDestinations:0,returnBudgetExhaustedDestinations:0,returnFrontierLimitedSearches:0,returnSegmentLimitedSearches:0,returnLimitEvents:[],returnBudgetRemaining:null,labelsPruned:0,resultsLimited:false,resultCount:0,resultLimit:null,truncationReasons:[],limits:configured};}
function routeSearchCap(value,fallback){return value===null?Infinity:Number.isInteger(value)&&value>0?value:fallback;}
function markSearchTruncated(diagnostics,reason){diagnostics.truncated=true;if(!diagnostics.truncationReasons.includes(reason))diagnostics.truncationReasons.push(reason);}
function capRouteFrontier(paths,limit,diagnostics,peakKey='frontierPeak',reason='frontier limit'){
  diagnostics[peakKey]=Math.max(diagnostics[peakKey],paths.length);
  if(paths.length>limit)markSearchTruncated(diagnostics,reason);
  return paths.slice(0,limit);
}
const connectionIndexCache=new WeakMap();
function connectionIndexFor(legs,start=null,end=null){
  let entry=connectionIndexCache.get(legs);
  if(!entry){const full=new Map();for(const leg of legs){if(!leg.from||!leg.to)continue;const key=transferNodeKey(leg.origin);if(!full.has(key))full.set(key,[]);full.get(key).push(leg);}for(const rows of full.values())rows.sort((a,b)=>a.from-b.from);entry={full,ranges:new Map()};connectionIndexCache.set(legs,entry);}
  if(!start&&!end)return entry.full;
  const key=`${start?.getTime()??''}:${end?.getTime()??''}`;if(entry.ranges.has(key))return entry.ranges.get(key);
  const lower=start?.getTime()??-Infinity,upper=end?.getTime()??Infinity,index=new Map();
  for(const [station,rows] of entry.full){const first=rows.findIndex(leg=>leg.from.getTime()>=lower);if(first<0)continue;let last=first;while(last<rows.length&&rows[last].from.getTime()<=upper)last++;if(last>first)index.set(station,rows.slice(first,last));}
  entry.ranges.set(key,index);while(entry.ranges.size>4)entry.ranges.delete(entry.ranges.keys().next().value);return index;
}
function routeLabelContext(path,options={}){
  const {keepFirstDeparture=false}=options,last=path.at(-1),currentTrip=String(last.tripId||last.id||''),usedTrips=[...new Set(path.map(leg=>String(leg.tripId||leg.id||'')).filter(trip=>trip!==currentTrip))].sort(),settings=options.connectionSettings,hasTransferRules=Boolean(settings?.rules?.trainByPair?.size||settings?.rules?.connectionByPair?.size),transferProfile=hasTransferRules?[last.destinationUic||'',last.train||'',last.connectionMode||'',last.connectionType||'',last.connectionRics||'']:[],key=[journeyChangeCount(path)+1,stationNodeKey(last.destination),currentTrip,...transferProfile,path.filter(leg=>leg.maxAvailable).length,path.filter(leg=>leg.paid).length,path.filter(leg=>leg.maxEligibilityUnknown).length,keepFirstDeparture?path[0].from.getTime():null].join('|');
  return{key,usedTrips:new Set(usedTrips),departure:path[0].from.getTime(),arrival:last.to.getTime(),duration:last.to.getTime()-path[0].from.getTime(),path};
}
function tripSetSubset(left,right){for(const trip of left)if(!right.has(trip))return false;return true;}
function routeLabelDominates(left,right,options={}){
  const tripSubset=tripSetSubset(left.usedTrips,right.usedTrips),timeBetter=options.arrivalOnly?left.arrival<=right.arrival:options.latestDeparture?left.departure>=right.departure&&left.arrival<=right.arrival&&left.duration<=right.duration:left.departure<=right.departure&&left.arrival<=right.arrival&&left.duration<=right.duration;
  return tripSubset&&timeBetter;
}
function keepRouteLabel(path,labelIndex,options={}){
  // A finite maximum wait makes an earlier arrival potentially too early for
  // a later transfer, so no arrival-time dominance is safe in that mode.
  if(!labelIndex||options.connectionSettings?.maximumMinutes!=null)return true;
  const candidate=routeLabelContext(path,options),labels=labelIndex.get(candidate.key)||[];
  if(labels.some(label=>routeLabelDominates(label,candidate,options))){options.diagnostics&&(options.diagnostics.labelsPruned++);return false;}
  const survivors=labels.filter(label=>!routeLabelDominates(candidate,label,options));
  options.diagnostics&&(options.diagnostics.labelsPruned+=labels.length-survivors.length);
  survivors.push(candidate);labelIndex.set(candidate.key,survivors);return true;
}
function filterRouteLabels(paths,labelIndex,options={}){return paths.filter(path=>keepRouteLabel(path,labelIndex,options));}
function firstDepartureAtOrAfter(rows,timestamp){let low=0,high=rows.length;while(low<high){const middle=(low+high)>>>1;if(rows[middle].from.getTime()<timestamp)low=middle+1;else high=middle;}return low;}
// Shared breadth-first connection expansion used by journey, Explore and
// closest-destination searches. Pareto labels discard equivalent partial
// paths while preserving alternatives that differ in useful time/eligibility.
function expandRouteFrontier(frontier,fromMap,{diagnostics,maxExpanded=50000,maxFrontier=15000,workKey='expanded',peakKey='frontierPeak',expansionReason=workKey==='returnExpanded'?'return expansion limit':'expansion limit',frontierReason='frontier limit',connectionSettings=null,canConnect=()=>true,classifyConnection=null,labelIndex=null,labelOptions={}}={}){
  const nextFrontier=[];let stopped=false,candidateCount=0;
  for(const path of frontier){const last=path.at(-1),departures=fromMap.get(transferNodeKey(last.destination))||[],first=firstDepartureAtOrAfter(departures,last.to.getTime()),maximum=connectionSettings?.maximumMinutes==null?Infinity:last.to.getTime()+Number(connectionSettings.maximumMinutes)*60000;for(let index=first;index<departures.length&&departures[index].from.getTime()<=maximum;index++){const next=departures[index];
    if(diagnostics[workKey]>=maxExpanded){markSearchTruncated(diagnostics,expansionReason);stopped=true;break;}
    diagnostics[workKey]++;
    if(!connectionGapAllowed(last,next,{connectionSettings}))continue;
    const decision=classifyConnection?classifyConnection(path,last,next):canConnect(path,last,next)?'expand':'skip';
    if(decision==='expand'||decision===true){
      candidateCount++;
      const candidate=[...path,next];
      if(nextFrontier.length>=maxFrontier){markSearchTruncated(diagnostics,frontierReason);continue;}
      if(keepRouteLabel(candidate,labelIndex,{...labelOptions,connectionSettings,diagnostics}))nextFrontier.push(candidate);
    }else if(decision==='stop'){stopped=true;break;}
  }if(stopped)break;}
  diagnostics[peakKey]=Math.max(diagnostics[peakKey],nextFrontier.length);
  const candidatePeakKey=peakKey==='returnFrontierPeak'?'returnFrontierCandidatesPeak':'frontierCandidatesPeak';
  diagnostics[candidatePeakKey]=Math.max(diagnostics[candidatePeakKey],candidateCount);
  return{frontier:nextFrontier,stopped};
}
function maybeIncludeSearchDiagnostics(results,options,diagnostics,key){return options?.includeDiagnostics?{[key]:results,searchDiagnostics:diagnostics}:results;}
function minimumTransfersToTarget(legs,isTarget){
  const stationsByTrip=new Map(),tripsByStation=new Map(),distance=new Map(),queue=[];
  const add=(map,key,value)=>{if(!map.has(key))map.set(key,new Set());map.get(key).add(value);};
  for(const leg of legs){const trip=String(leg.tripId||leg.id||leg.train||''),origin=transferNodeKey(leg.origin),destination=transferNodeKey(leg.destination);add(stationsByTrip,trip,origin);add(stationsByTrip,trip,destination);add(tripsByStation,origin,trip);add(tripsByStation,destination,trip);if(isTarget(leg)&&!distance.has(trip)){distance.set(trip,0);queue.push(trip);}}
  const expandedStations=new Set();
  for(let index=0;index<queue.length;index++){const trip=queue[index],nextDistance=distance.get(trip)+1;for(const station of stationsByTrip.get(trip)||[]){if(expandedStations.has(station))continue;expandedStations.add(station);for(const previousTrip of tripsByStation.get(station)||[]){if(previousTrip===trip||distance.has(previousTrip))continue;distance.set(previousTrip,nextDistance);queue.push(previousTrip);}}}
  return distance;
}
export function findJourneys(legs,origin,destination,startDate,endDate,limit=25,departureEndDate=endDate,connectionSettings=null,searchLimits={}){
  const start=parisStartOfDay(startDate),end=parisEndOfDay(endDate),departureEnd=parisEndOfDay(departureEndDate),fromMap=connectionIndexFor(legs,start,end);
  const startLegs=legs.filter(leg=>leg.from&&leg.to&&leg.from>=start&&leg.from<=departureEnd&&stationMatchesSelection(origin,leg.origin)),isTarget=leg=>stationMatchesSelection(destination,leg.destination),results=[];
  const maxExpanded=routeSearchCap(Object.hasOwn(searchLimits,'maxExpanded')?searchLimits.maxExpanded:searchLimits.expanded,60000),maxFrontier=routeSearchCap(Object.hasOwn(searchLimits,'maxFrontier')?searchLimits.maxFrontier:searchLimits.frontier,12000),maxSegments=Number.isInteger(searchLimits.maxSegments)&&searchLimits.maxSegments>0?searchLimits.maxSegments:30,diagnostics=routeSearchDiagnostics({expanded:maxExpanded,frontier:maxFrontier,segments:maxSegments});
  results.push(...startLegs.filter(isTarget).map(leg=>[leg]));
  if(searchLimits.router==='csa'){
    const scanned=scanJourneysCsa({legs,origin,end,startLegs,isTarget,fromMap,connectionSettings,maxSegments,maxExpanded,maxFrontier,diagnostics});
    results.push(...scanned);
  }else{
    const minTransfersToTarget=minimumTransfersToTarget(legs,isTarget);
    const labelIndex=new Map(),labelOptions={};
    let frontier=filterRouteLabels(startLegs.filter(first=>!isTarget(first)&&(minTransfersToTarget.get(journeyTripKey(first))??Infinity)<=4).map(first=>[first]),labelIndex,{...labelOptions,connectionSettings,diagnostics});frontier=capRouteFrontier(frontier,maxFrontier,diagnostics);
    // Permit up to four changes and very long layovers: overnight/next-day
    // connections can be the only usable MAX route on a given date.
    for(let depth=1;depth<maxSegments&&frontier.length;depth++){
      const expanded=expandRouteFrontier(frontier,fromMap,{diagnostics,maxExpanded,maxFrontier,connectionSettings,frontierReason:'frontier limit',classifyConnection:(path,last,next)=>{
        if(next.from>end||next.to>end||reusesEarlierTrip(path,next))return'skip';
        const changes=journeyChangeCount(path)+(journeyTripKey(last)===journeyTripKey(next)?0:1);
        if(isTarget(next)){if(changes<=4)results.push([...path,next]);return'skip';}
        if(depth===maxSegments-1){markSearchTruncated(diagnostics,'segment count limit');return'skip';}
        return changes+(minTransfersToTarget.get(journeyTripKey(next))??Infinity)<=4?'expand':'skip';
      },labelIndex,labelOptions});
      frontier=expanded.frontier;if(expanded.stopped)break;
    }
  }
  const unique=new Map();for(const path of results){const maxLegCount=path.filter(x=>x.maxAvailable).length,paidLegCount=path.filter(x=>x.paid).length,key=path.map(x=>`${x.train}|${stationNodeKey(x.origin)}>${stationNodeKey(x.destination)}|${x.from.getTime()}-${x.to.getTime()}`).join('>');const prior=unique.get(key);if(!prior||maxLegCount>(prior.maxLegCount||0))unique.set(key,path);}const journeys=[...unique.values()].map(path=>({legs:path,departure:path[0].from,arrival:path.at(-1).to,duration:(path.at(-1).to-path[0].from)/60000,changes:journeyChangeCount(path),sameTrainReboard:path.some((leg,i)=>path.slice(0,i).some(previous=>previous.tripId===leg.tripId)),maxLegs:path.filter(x=>x.maxAvailable).length,ouigoLegs:path.filter(x=>x.maxEligibilityUnknown).length,paidLegs:path.filter(x=>x.paid).length,overnight:path.some((leg,i)=>i>0&&parisDateKey(leg.from)!==parisDateKey(path[i-1].to))}));
  // Remove exact timetable duplicates: a MAX availability record and its GTFS
  // counterpart can represent the same train with slightly different clocks.
  // Prefer the MAX feed's displayed times for available direct journeys.
  const departures=new Map();for(const j of journeys){const sameService=j.legs.every(leg=>journeyTripKey(leg)===journeyTripKey(j.legs[0])),signature=sameService?`${stationNodeKey(j.legs[0].origin)}>${stationNodeKey(j.legs.at(-1).destination)}|${j.departure.getTime()}-${j.arrival.getTime()}`:j.legs.map(l=>`${stationNodeKey(l.origin)}>${stationNodeKey(l.destination)}|${l.from.getTime()}-${l.to.getTime()}`).join('>'),prior=departures.get(signature);if(!prior){departures.set(signature,{...j,legs:j.legs.map(leg=>({...leg,trainAlternates:[String(leg.train)]}))});continue;}const preferred=j.maxLegs>prior.maxLegs||j.maxLegs===prior.maxLegs&&j.paidLegs<prior.paidLegs||j.maxLegs===prior.maxLegs&&j.paidLegs===prior.paidLegs&&j.duration<prior.duration?j:prior,alternates=prior.legs.map((leg,i)=>[...new Set([...(leg.trainAlternates||[String(leg.train)]),...(j.legs[i]?.trainAlternates||[String(j.legs[i]?.train||'')])].filter(Boolean))]);departures.set(signature,{...preferred,legs:preferred.legs.map((leg,i)=>({...leg,trainAlternates:alternates[i]||[String(leg.train)]}))});}
  const uniqueJourneys=[...departures.values()],fastest=[...uniqueJourneys].sort((a,b)=>a.duration-b.duration||a.changes-b.changes)[0],rank=(a,b)=>a.changes-b.changes||a.duration-b.duration||b.maxLegs-a.maxLegs;
  const nightTrains=uniqueJourneys.filter(j=>j.legs.some(leg=>leg.nightTrain&&leg.maxAvailable)).sort(rank).slice(0,limit),dayJourneys=uniqueJourneys.filter(j=>!j.legs.some(leg=>leg.nightTrain&&leg.maxAvailable));
  const directMax=dayJourneys.filter(j=>j.changes===0&&j.maxLegs>0&&j.ouigoLegs===0).sort((a,b)=>a.departure-b.departure),rest=dayJourneys.filter(j=>!(j.changes===0&&j.maxLegs>0&&j.ouigoLegs===0)).sort((a,b)=>a.paidLegs-b.paidLegs||rank(a,b));
  const maxFirst=[...directMax,...rest.filter(j=>j.maxLegs>0&&j.ouigoLegs===0)].slice(0,Math.max(limit,directMax.length)),ouigoCandidates=uniqueJourneys.filter(j=>j.ouigoLegs>0&&j.paidLegs===0).sort(rank).slice(0,limit);
  return {maxFirst,nightTrains,ouigoCandidates,fastest:fastest?{...fastest,resultType:'fastest'}:null,searchDiagnostics:{truncated:diagnostics.truncated,expanded:diagnostics.expanded,frontierPeak:diagnostics.frontierPeak,frontierCandidatesPeak:diagnostics.frontierCandidatesPeak,labelsPruned:diagnostics.labelsPruned,truncationReasons:diagnostics.truncationReasons,limits:{expanded:diagnostics.limits.expanded,frontier:diagnostics.limits.frontier}}};
}
function scanJourneysCsa({legs,origin,end,startLegs,isTarget,fromMap,connectionSettings,maxSegments,maxExpanded,maxFrontier,diagnostics}){
  const minTransfersToTarget=minimumTransfersToTarget(legs,isTarget),labelOptions={connectionSettings,diagnostics},resultsByKey=new Map();
  const keyFor=path=>path.map(leg=>`${leg.train}|${stationNodeKey(leg.origin)}>${stationNodeKey(leg.destination)}|${leg.from.getTime()}-${leg.to.getTime()}`).join('>');
  let previous=new Map(),frontierSize=0,candidateCount=0,stopped=false;
  const addLabel=(map,path)=>{
    const last=path.at(-1),node=transferNodeKey(last.destination);
    if(!map.has(node))map.set(node,new Map());
    const byKey=map.get(node),candidate=routeLabelContext(path,labelOptions);
    if(!byKey.has(candidate.key))byKey.set(candidate.key,[]);
    const labels=byKey.get(candidate.key);
    if(connectionSettings?.maximumMinutes==null&&labels.some(label=>routeLabelDominates(label.context,candidate,labelOptions))){diagnostics.labelsPruned++;return;}
    if(connectionSettings?.maximumMinutes==null){
      const survivors=labels.filter(label=>!routeLabelDominates(candidate,label.context,labelOptions));
      diagnostics.labelsPruned+=labels.length-survivors.length;
      frontierSize-=labels.length-survivors.length;
      labels.splice(0,labels.length,...survivors);
    }
    if(frontierSize>=maxFrontier){markSearchTruncated(diagnostics,'frontier limit');candidateCount++;return;}
    labels.push({path,context:candidate});frontierSize++;candidateCount++;
  };
  for(const first of startLegs){
    if(isTarget(first)||(minTransfersToTarget.get(journeyTripKey(first))??Infinity)>4)continue;
    addLabel(previous,[first]);
  }
  diagnostics.frontierPeak=frontierSize;
  diagnostics.frontierCandidatesPeak=Math.max(diagnostics.frontierCandidatesPeak,candidateCount);
  for(let segments=2;segments<=maxSegments&&previous.size;segments++){
    const current=new Map();frontierSize=0;candidateCount=0;
    for(const [node,byKey] of previous){
      const departures=fromMap.get(node)||[];
      for(const next of departures){
        for(const labels of byKey.values())for(const label of labels){
          const path=label.path;
          const last=path.at(-1);
          if(next.from<last.to||next.from>end||next.to>end||reusesEarlierTrip(path,next))continue;
          if(diagnostics.expanded>=maxExpanded){markSearchTruncated(diagnostics,'expansion limit');stopped=true;break;}
          diagnostics.expanded++;
          if(!connectionGapAllowed(last,next,{connectionSettings}))continue;
          if(stationNodeKey(next.destination)===stationNodeKey(last.destination))continue;
          const candidate=[...path,next],changes=journeyChangeCount(candidate);
          if(changes>4)continue;
          if(isTarget(next)){
            const resultKey=keyFor(candidate),prior=resultsByKey.get(resultKey);
            if(!prior||candidate.filter(leg=>leg.maxAvailable).length>prior.filter(leg=>leg.maxAvailable).length)resultsByKey.set(resultKey,candidate);
            continue;
          }
          if(segments===maxSegments){markSearchTruncated(diagnostics,'segment count limit');continue;}
          if(changes+(minTransfersToTarget.get(journeyTripKey(next))??Infinity)<=4)addLabel(current,candidate);
        }
        if(stopped)break;
      }
      if(stopped)break;
    }
    diagnostics.frontierPeak=Math.max(diagnostics.frontierPeak,frontierSize);
    diagnostics.frontierCandidatesPeak=Math.max(diagnostics.frontierCandidatesPeak,candidateCount);
    previous=current;
    if(stopped)break;
  }
  return [...resultsByKey.values()];
}
const journeyKey = journey => journey?.legs?.map(leg => leg.id).join('|') || '';
const journeyTripKey = leg => String(leg?.tripId||leg?.id||leg?.train||'');
const reusesEarlierTrip = (path,next) => journeyTripKey(path.at(-1))!==journeyTripKey(next)&&path.slice(0,-1).some(leg=>journeyTripKey(leg)===journeyTripKey(next));
const journeyChangeCount = path => path.slice(1).reduce((count,leg,index)=>count+(journeyTripKey(leg)===journeyTripKey(path[index])?0:1),0);
function outboundReturnCompatibilityKey(journey,connectionSettings,returnLegs=[],cache=new Map()){
  const rules=connectionSettings?.rules;
  if(!connectionSettings||connectionSettings.mode==='none'||connectionSettings.mode==='manual'||!rules?.trainByPair?.size&&!rules?.connectionByPair?.size)return'';
  const last=journey.legs.at(-1),profileKey=JSON.stringify([last.destinationUic||stationUic(last.destination,rules)||'',last.train||'',last.connectionMode||'F',last.connectionType||'',last.connectionRics||'']);
  if(cache.has(profileKey))return cache.get(profileKey);
  const signature=returnLegs.map(next=>{
    const rule=connectionMinimum(last,next,{connectionSettings});
    return JSON.stringify([next.originUic||stationUic(next.origin,rules)||'',next.train||'',next.connectionMode||'F',next.connectionType||'',next.connectionRics||'',rule.minutes,rule.forbidden]);
  }).sort().join('|');
  cache.set(profileKey,signature);
  return signature;
}
function rememberOutboundCandidate(bestByNode,node,journey,{preserveReturnAlternatives=false,connectionSettings=null,returnLegs=[],compatibilityCache}={}){
  const changes=journey.changes;
  if(!bestByNode.has(node))bestByNode.set(node,new Map());
  const byChanges=bestByNode.get(node);
  if(!byChanges.has(changes))byChanges.set(changes,new Map());
  const byCompatibility=byChanges.get(changes),compatibilityKey=preserveReturnAlternatives?outboundReturnCompatibilityKey(journey,connectionSettings,returnLegs,compatibilityCache):'';
  const prior=byCompatibility.get(compatibilityKey);
  if(!prior||journey.arrival<prior.arrival||journey.arrival.getTime()===prior.arrival.getTime()&&journey.departure<prior.departure)byCompatibility.set(compatibilityKey,journey);
}
function outboundCandidatesByChanges(byChanges){
  return[...byChanges.entries()].flatMap(([changes,candidates])=>[...candidates.values()].map(outbound=>[changes,outbound]));
}
export function alignSameDay(outbound,returning,sameDay){if(!sameDay)return null;const outs=[...outbound.maxFirst,...(outbound.nightTrains||[]),...(outbound.ouigoCandidates||[]),...(outbound.fastest?[outbound.fastest]:[])],backs=[...returning.maxFirst,...(returning.nightTrains||[]),...(returning.ouigoCandidates||[]),...(returning.fastest?[returning.fastest]:[])],pairs=[];for(const out of outs)for(const back of backs)if(back.departure-out.arrival>=30*60000&&parisDateKey(back.arrival)===parisDateKey(out.arrival))pairs.push([journeyKey(out),journeyKey(back)]);if(!pairs.length)return 'No same-day pair in these results leaves 30 minutes at the destination and returns on the same date. Showing the available directions anyway, including long connections.';const goodOut=new Set(pairs.map(pair=>pair[0])),goodBack=new Set(pairs.map(pair=>pair[1]));outbound.maxFirst=outbound.maxFirst.filter(j=>goodOut.has(journeyKey(j)));outbound.nightTrains=(outbound.nightTrains||[]).filter(j=>goodOut.has(journeyKey(j)));outbound.ouigoCandidates=(outbound.ouigoCandidates||[]).filter(j=>goodOut.has(journeyKey(j)));if(outbound.fastest&&!goodOut.has(journeyKey(outbound.fastest)))outbound.fastest=null;returning.maxFirst=returning.maxFirst.filter(j=>goodBack.has(journeyKey(j)));returning.nightTrains=(returning.nightTrains||[]).filter(j=>goodBack.has(journeyKey(j)));returning.ouigoCandidates=(returning.ouigoCandidates||[]).filter(j=>goodBack.has(journeyKey(j)));if(returning.fastest&&!goodBack.has(journeyKey(returning.fastest)))returning.fastest=null;return null;}
export function findClosestJourneys(legs,origin,destination,startDate,endDate,stops=[],limit=5,departureEndDate=endDate,connectionSettings=null,searchOptions={}){
  const key=stationNodeKey,target=key(destination),start=parisStartOfDay(startDate),end=parisEndOfDay(endDate),departureEnd=parisEndOfDay(departureEndDate),coords=new Map(),limits={...DEFAULT_ROUTE_SEARCH_LIMITS,...searchOptions.searchLimits,expanded:routeSearchCap(searchOptions.searchLimits?.expanded,60000),frontier:routeSearchCap(searchOptions.searchLimits?.frontier,12000)},diagnostics=routeSearchDiagnostics(limits);
  for(const stop of stops){if(!stop.stop_lat||!stop.stop_lon)continue;const lat=Number(stop.stop_lat),lon=Number(stop.stop_lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const k=key(stop.stop_name);if(!coords.has(k))coords.set(k,[]);coords.get(k).push({lat,lon,name:stop.stop_name});}
  const targetStops=stops.filter(stop=>stop.stop_lat&&stop.stop_lon&&stationMatchesSelection(destination,stop.stop_name)),targetPoint=targetStops.length?targetStops.reduce((p,stop)=>({lat:p.lat+Number(stop.stop_lat),lon:p.lon+Number(stop.stop_lon)}),{lat:0,lon:0}):coords.get(target)?.[0];if(targetPoint&&targetStops.length){targetPoint.lat/=targetStops.length;targetPoint.lon/=targetStops.length;}
  if(!targetPoint||!Number.isFinite(targetPoint.lat)||!Number.isFinite(targetPoint.lon))return maybeIncludeSearchDiagnostics([],searchOptions,diagnostics,'journeys');
  const distance=(a,b)=>{const rad=n=>n*Math.PI/180,R=6371,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
  const fromMap=connectionIndexFor(legs,start,end);
  const labelIndex=new Map(),labelOptions={};
  let frontier=filterRouteLabels(legs.filter(leg=>leg.from&&leg.to&&leg.from>=start&&leg.from<=departureEnd&&stationMatchesSelection(origin,leg.origin)&&(leg.maxAvailable||leg.maxEligibilityUnknown)&&!leg.paid&&!stationMatchesSelection(origin,leg.destination)).map(leg=>[leg]),labelIndex,{...labelOptions,connectionSettings,diagnostics});frontier=capRouteFrontier(frontier,limits.frontier,diagnostics);let depth=0;const bestByStop=new Map(),maximumSegments=Math.max(1,Number(searchOptions.searchLimits?.maxSegments)||30);
  for(;depth<maximumSegments&&frontier.length;depth++){
    for(const path of frontier){const last=path.at(-1),node=key(last.destination),points=coords.get(node);if(!stationMatchesSelection(origin,last.destination)&&!stationMatchesSelection(destination,last.destination)&&points?.length){const km=Math.min(...points.map(point=>distance(point,targetPoint))),journey={legs:path,departure:path[0].from,arrival:last.to,duration:(last.to-path[0].from)/60000,changes:journeyChangeCount(path),maxLegs:path.filter(leg=>leg.maxAvailable).length,ouigoLegs:path.filter(leg=>leg.maxEligibilityUnknown).length,paidLegs:0,closest:true,distanceKm:Math.round(km)};const old=bestByStop.get(node);if(!old||journey.distanceKm<old.distanceKm||journey.distanceKm===old.distanceKm&&journey.duration<old.duration)bestByStop.set(node,journey);}}
    if(depth===maximumSegments-1){if(frontier.length)markSearchTruncated(diagnostics,'segment count limit');break;}
    const expanded=expandRouteFrontier(frontier,fromMap,{diagnostics,maxExpanded:limits.expanded,maxFrontier:limits.frontier,connectionSettings,frontierReason:'frontier limit',labelIndex,labelOptions,canConnect:(path,last,next)=>{const node=key(last.destination);return(next.maxAvailable||next.maxEligibilityUnknown)&&!next.paid&&next.from<=end&&next.to<=end&&!reusesEarlierTrip(path,next)&&journeyChangeCount([...path,next])<=5&&key(next.destination)!==node;}});
    frontier=expanded.frontier;if(expanded.stopped)break;
  }
  const results=[...bestByStop.values()].sort((a,b)=>a.distanceKm-b.distanceKm||a.changes-b.changes||a.duration-b.duration).slice(0,limit);
  return maybeIncludeSearchDiagnostics(results,searchOptions,diagnostics,'journeys');
}
export function findReachableDestinations(records,stops,origin,date,options={}){
  const {mode='oneway',returnDate=date,changes=[0,1,2],departureCutoff=null,connectionSettings=null,minimumStayMinutes=180,includeDiagnostics=false}=options,limits={...DEFAULT_ROUTE_SEARCH_LIMITS,...options.searchLimits,expanded:routeSearchCap(options.searchLimits?.expanded,DEFAULT_ROUTE_SEARCH_LIMITS.expanded),frontier:routeSearchCap(options.searchLimits?.frontier,DEFAULT_ROUTE_SEARCH_LIMITS.frontier),returnExpanded:routeSearchCap(options.searchLimits?.returnExpanded,DEFAULT_ROUTE_SEARCH_LIMITS.returnExpanded),returnFrontier:routeSearchCap(options.searchLimits?.returnFrontier,DEFAULT_ROUTE_SEARCH_LIMITS.returnFrontier)},diagnostics=routeSearchDiagnostics(limits),allowed=[...new Set(changes.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=5))].sort((a,b)=>a-b),maxChanges=Math.max(0,...allowed),start=parisStartOfDay(date),dayEnd=parisEndOfDay(date),outboundArrivalEnd=mode==='daytrip'?dayEnd:parisEndOfDay(addServiceDays(date,1));
  if(!allowed.length)return maybeIncludeSearchDiagnostics([],options,diagnostics,'destinations');
  if(mode==='oneway'&&options.router==='csa')return findOneWayReachableDestinationsCsa(records,stops,origin,date,options,allowed,limits);
  const returnDay=mode==='return'?returnDate:date,returnStart=parisStartOfDay(returnDay),returnDayEnd=parisEndOfDay(returnDay),returnArrivalEnd=mode==='return'?parisEndOfDay(addServiceDays(returnDay,1)):returnDayEnd;
  const cutoff=departureCutoff?new Date(departureCutoff):null,available=records.map(normalizeMax).filter(leg=>leg?.available&&stationKey(leg.origin)!==stationKey(leg.destination)),outboundLegs=available.filter(leg=>leg.from>=start&&(!cutoff||leg.from>=cutoff)&&leg.from<=outboundArrivalEnd&&leg.to<=outboundArrivalEnd),returnLegs=mode==='daytrip'?available.filter(leg=>leg.from>=returnStart&&leg.from<=returnDayEnd&&leg.to<=returnDayEnd):mode==='return'?available.filter(leg=>leg.from>=returnStart&&leg.from<=returnArrivalEnd&&leg.to<=returnArrivalEnd):[];
  const fromMap=connectionIndexFor(outboundLegs),returnFromMap=connectionIndexFor(returnLegs),outboundLabelIndex=new Map(),outboundLabelOptions={arrivalOnly:true},outboundCompatibilityCache=new Map();
  const scannedOutbound=mode==='daytrip'&&options.router==='csa'?findOneWayReachableDestinationsCsa(records,stops,origin,date,{...options,csaOutboundOnly:true,returnFromMap},allowed,limits):null;
  if(scannedOutbound){diagnostics.limits.expanded=null;diagnostics.limits.frontier=null;diagnostics.expanded=scannedOutbound.diagnostics.expanded;diagnostics.labelsPruned+=scannedOutbound.diagnostics.labelsPruned;for(const reason of scannedOutbound.diagnostics.truncationReasons)markSearchTruncated(diagnostics,reason);}
  const nodes=new Map();for(const stop of stops){if(!stop.stop_lat||!stop.stop_lon||stop.parent_station)continue;const lat=Number(stop.stop_lat),lon=Number(stop.stop_lon);if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;const key=stationNodeKey(stop.stop_name);if(!nodes.has(key))nodes.set(key,{names:[],points:[]});nodes.get(key).names.push(stop.stop_name);nodes.get(key).points.push({lat,lon});}
  for(const leg of available)for(const [name,code] of [[leg.origin,leg.originIata],[leg.destination,leg.destinationIata]]){const point=coordinatesForIataCode(code),key=stationNodeKey(name);if(point&&!nodes.has(key))nodes.set(key,{names:[name],points:[point]});}
  const makeJourney=path=>({legs:path,departure:path[0].from,arrival:path.at(-1).to,duration:(path.at(-1).to-path[0].from)/60000,changes:journeyChangeCount(path),maxLegs:path.length,paidLegs:0,sameTrainReboard:path.some((leg,index)=>path.slice(0,index).some(previous=>previous.tripId===leg.tripId))});
  const maximumSegments=Math.max(1,Number(options.searchLimits?.maxSegments)||30),bestByNode=scannedOutbound?.bestByNode||new Map();
  if(!scannedOutbound){
    let frontier=filterRouteLabels(outboundLegs.filter(leg=>leg.from<=dayEnd&&leg.to<=outboundArrivalEnd&&stationMatchesSelection(origin,leg.origin)).map(leg=>[leg]),outboundLabelIndex,{...outboundLabelOptions,connectionSettings,diagnostics});frontier=capRouteFrontier(frontier,limits.frontier,diagnostics);
    for(let depth=0;depth<maximumSegments&&frontier.length;depth++){
      for(const path of frontier){const last=path.at(-1),node=stationNodeKey(last.destination),count=journeyChangeCount(path);if(!stationMatchesSelection(origin,last.destination)&&allowed.includes(count)&&nodes.has(node)){const journey=makeJourney(path);rememberOutboundCandidate(bestByNode,node,journey,{preserveReturnAlternatives:mode==='daytrip',connectionSettings,returnLegs:returnFromMap.get(transferNodeKey(last.destination))||[],compatibilityCache:outboundCompatibilityCache});}}
      if(depth===maximumSegments-1){if(frontier.length)markSearchTruncated(diagnostics,'segment count limit');break;}
      const expanded=expandRouteFrontier(frontier,fromMap,{diagnostics,maxExpanded:limits.expanded,maxFrontier:limits.frontier,connectionSettings,labelIndex:outboundLabelIndex,labelOptions:outboundLabelOptions,canConnect:(path,last,next)=>next.from<=outboundArrivalEnd&&next.to<=outboundArrivalEnd&&!reusesEarlierTrip(path,next)&&journeyChangeCount([...path,next])<=maxChanges&&stationNodeKey(next.destination)!==stationNodeKey(last.destination)});
      frontier=expanded.frontier;if(expanded.stopped)break;
    }
  }
  const findReturn=(arrivedAt,arrivalStation,outboundJourney,returnExpansionBudget=limits.returnExpanded,phase='initial')=>{
    const latestArrival=mode==='return'?returnArrivalEnd:returnDayEnd,minStay=mode==='daytrip'?Math.max(0,Number(minimumStayMinutes)||0):0,returnDiagnostics=routeSearchDiagnostics({...limits,expanded:returnExpansionBudget}),returnLabelIndex=new Map(),returnLabelOptions={latestDeparture:true};
    const finish=journey=>{
      diagnostics.returnExpanded+=returnDiagnostics.expanded;
      diagnostics.returnFrontierPeak=Math.max(diagnostics.returnFrontierPeak,returnDiagnostics.frontierPeak);
      diagnostics.returnFrontierCandidatesPeak=Math.max(diagnostics.returnFrontierCandidatesPeak,returnDiagnostics.frontierCandidatesPeak);
      diagnostics.labelsPruned+=returnDiagnostics.labelsPruned;
      const reasons=returnDiagnostics.truncationReasons.map(reason=>reason==='expansion limit'?'return expansion limit':reason==='frontier limit'?'return frontier limit':reason==='segment count limit'?'return segment count limit':reason);
      for(const reason of reasons){
        if(reason==='return expansion limit')diagnostics.returnExpansionLimitedSearches++;
        else if(reason==='return frontier limit')diagnostics.returnFrontierLimitedSearches++;
        else if(reason==='return segment count limit')diagnostics.returnSegmentLimitedSearches++;
      }
      if((reasons.length||phase==='redistributed')&&diagnostics.returnLimitEvents.length<50)diagnostics.returnLimitEvents.push({destination:outboundJourney.legs.at(-1).destination,phase,budget:Number.isFinite(returnExpansionBudget)?returnExpansionBudget:null,expanded:returnDiagnostics.expanded,frontierPeak:returnDiagnostics.frontierPeak,foundJourney:Boolean(journey),reasons});
      if(mode!=='daytrip')for(const reason of reasons)markSearchTruncated(diagnostics,reason);
      return{journey,expanded:returnDiagnostics.expanded,truncationReasons:reasons};
    };
    let paths=filterRouteLabels((returnFromMap.get(transferNodeKey(arrivalStation))||[]).filter(leg=>{const gap=(leg.from-arrivedAt)/60000,minimum=connectionMinimum(outboundJourney.legs.at(-1),leg,{connectionSettings});return!minimum.forbidden&&gap>=Math.max(minStay,minimum.minutes)&&leg.from<=returnDayEnd&&leg.to<=latestArrival;}).sort((a,b)=>b.from-a.from).map(leg=>[leg]),returnLabelIndex,{...returnLabelOptions,connectionSettings,diagnostics:returnDiagnostics});
    paths=capRouteFrontier(paths,limits.returnFrontier,returnDiagnostics,'frontierPeak','return frontier limit');diagnostics.returnSearches++;
    for(let depth=0;depth<maximumSegments&&paths.length;depth++){
      for(const path of paths){const last=path.at(-1),count=journeyChangeCount(path);if(stationMatchesSelection(origin,last.destination)&&allowed.includes(count))return finish(makeJourney(path));}
      if(depth===maximumSegments-1){if(paths.length)markSearchTruncated(returnDiagnostics,'segment count limit');break;}
      const expanded=expandRouteFrontier(paths,returnFromMap,{diagnostics:returnDiagnostics,maxExpanded:returnExpansionBudget,maxFrontier:limits.returnFrontier,expansionReason:'expansion limit',connectionSettings,frontierReason:'return frontier limit',labelIndex:returnLabelIndex,labelOptions:returnLabelOptions,canConnect:(path,last,next)=>next.from<=latestArrival&&next.to<=latestArrival&&!reusesEarlierTrip(path,next)&&journeyChangeCount([...path,next])<=maxChanges&&stationNodeKey(next.destination)!==stationNodeKey(last.destination)});
      paths=expanded.frontier;if(expanded.stopped)break;
    }
    return finish(null);
  };
  const results=new Map(),pendingDayTripReturns=[],destinations=[...bestByNode.entries()];
  const rememberDestination=(key,options)=>{
    options.sort((a,b)=>a.outChanges-b.outChanges||a.outbound.arrival-b.outbound.arrival||((b.returning?.departure||0)-(a.returning?.departure||0)));
    const chosen=options[0],node=nodes.get(key),point=node.points.reduce((p,c)=>({lat:p.lat+c.lat,lon:p.lon+c.lon}),{lat:0,lon:0});
    results.set(key,{key,name:chosen.outbound.legs.at(-1).destination,lat:point.lat/node.points.length,lon:point.lon/node.points.length,changes:chosen.outChanges,outbound:chosen.outbound,returning:chosen.returning||null});
  };
  // Give the shared day-trip return budget to destinations with the largest
  // window for a feasible return first; unused work is redistributed below.
  if(mode==='daytrip')destinations.sort((a,b)=>Math.min(...outboundCandidatesByChanges(a[1]).map(([,value])=>value.arrival.getTime()))-Math.min(...outboundCandidatesByChanges(b[1]).map(([,value])=>value.arrival.getTime()))||a[0].localeCompare(b[0]));
  let returnBudgetRemaining=limits.returnExpanded,returnDestinationsRemaining=destinations.length;
  for(const [key,byChanges] of destinations){
    const outboundOptions=outboundCandidatesByChanges(byChanges).sort((a,b)=>mode==='daytrip'?a[1].arrival-b[1].arrival||a[0]-b[0]:a[0]-b[0]),options=[],retryCandidates=[],incompleteReasons=new Set();
    let destinationReturnBudget=Infinity;
    if(mode==='daytrip'&&Number.isFinite(returnBudgetRemaining)){
      destinationReturnBudget=returnDestinationsRemaining>0?Math.ceil(returnBudgetRemaining/returnDestinationsRemaining):0;
      returnDestinationsRemaining--;
    }
    for(let optionIndex=0;optionIndex<outboundOptions.length;optionIndex++){
      const [outChanges,outbound]=outboundOptions[optionIndex];
      if(mode==='oneway'){options.push({outbound,outChanges});continue;}
      if(mode==='daytrip'&&destinationReturnBudget<=0){markSearchTruncated(diagnostics,'return expansion limit');diagnostics.returnBudgetExhaustedDestinations++;diagnostics.returnExpansionIncompleteDestinations++;if(diagnostics.returnLimitEvents.length<50)diagnostics.returnLimitEvents.push({destination:outbound.legs.at(-1).destination,phase:'initial',budget:0,expanded:0,frontierPeak:0,foundJourney:false,reasons:['shared return budget exhausted']});break;}
      const returnBudget=mode==='daytrip'?destinationReturnBudget:limits.returnExpanded;
      const returned=findReturn(outbound.arrival,outbound.legs.at(-1).destination,outbound,returnBudget);
      if(mode==='daytrip'&&Number.isFinite(returnBudgetRemaining)){
        const consumed=Math.min(returnBudgetRemaining,returned.expanded);
        returnBudgetRemaining-=consumed;destinationReturnBudget=Math.max(0,destinationReturnBudget-consumed);
      }
      if(returned.journey){options.push({outbound,outChanges,returning:returned.journey});if(mode==='daytrip')break;}
      if(mode==='daytrip'&&!returned.journey){
        if(returned.truncationReasons.includes('return expansion limit'))retryCandidates.push({outChanges,outbound});
        else for(const reason of returned.truncationReasons)incompleteReasons.add(reason);
      }
      if(mode==='daytrip'&&destinationReturnBudget<=0){
        retryCandidates.push(...outboundOptions.slice(optionIndex+1).map(([nextChanges,nextOutbound])=>({outChanges:nextChanges,outbound:nextOutbound})));
        break;
      }
    }
    if(options.length)rememberDestination(key,options);
    else if(mode==='daytrip'&&(retryCandidates.length||incompleteReasons.size))pendingDayTripReturns.push({key,candidates:retryCandidates,incompleteReasons:[...incompleteReasons]});
  }
  if(mode==='daytrip'&&!Number.isFinite(returnBudgetRemaining)){
    for(const pending of pendingDayTripReturns){diagnostics.returnExpansionIncompleteDestinations++;for(const reason of pending.incompleteReasons)markSearchTruncated(diagnostics,reason);}
    pendingDayTripReturns.length=0;
  }
  let retryDestinationsRemaining=pendingDayTripReturns.length;
  for(const pending of pendingDayTripReturns){
    retryDestinationsRemaining--;
    const unresolvedReasons=new Set(pending.incompleteReasons),options=[];
    let retryBudget=Number.isFinite(returnBudgetRemaining)&&retryDestinationsRemaining>=0&&retryDestinationsRemaining+1>0?Math.ceil(returnBudgetRemaining/(retryDestinationsRemaining+1)):Infinity;
    if(mode==='daytrip'&&Number.isFinite(returnBudgetRemaining)&&retryBudget<=0){
      unresolvedReasons.add('return expansion limit');diagnostics.returnBudgetExhaustedDestinations++;
    }else{
      for(let candidateIndex=0;candidateIndex<pending.candidates.length;candidateIndex++){
        if(retryBudget<=0){if(candidateIndex<pending.candidates.length)unresolvedReasons.add('return expansion limit');break;}
        const {outChanges,outbound}=pending.candidates[candidateIndex],returned=findReturn(outbound.arrival,outbound.legs.at(-1).destination,outbound,retryBudget,'redistributed');
        if(mode==='daytrip'&&Number.isFinite(returnBudgetRemaining)){
          const consumed=Math.min(returnBudgetRemaining,returned.expanded);returnBudgetRemaining-=consumed;retryBudget=Math.max(0,retryBudget-consumed);
        }
        if(returned.journey){options.push({outbound,outChanges,returning:returned.journey});break;}
        for(const reason of returned.truncationReasons)unresolvedReasons.add(reason);
        if(retryBudget<=0&&candidateIndex<pending.candidates.length-1)unresolvedReasons.add('return expansion limit');
      }
    }
    if(options.length)rememberDestination(pending.key,options);
    else if(unresolvedReasons.size){
      diagnostics.returnExpansionIncompleteDestinations++;
      for(const reason of unresolvedReasons)markSearchTruncated(diagnostics,reason);
    }
  }
  const sorted=[...results.values()].sort((a,b)=>a.changes-b.changes||a.outbound.arrival-b.outbound.arrival||a.name.localeCompare(b.name));
  diagnostics.returnBudgetRemaining=mode==='daytrip'&&Number.isFinite(returnBudgetRemaining)?returnBudgetRemaining:null;
  diagnostics.resultCount=sorted.length;
  return maybeIncludeSearchDiagnostics(sorted,options,diagnostics,'destinations');
}

// Connection-scan search for one-way Explore and the opt-in day-trip outbound
// experiment. Day-trip callers keep same-day connections and pass raw labels
// back to the bounded return-pairing stage. Each round scans connections in
// departure order and extends labels from the previous ride count. Labels are
// grouped by their last connection so train-specific transfer rules remain
// available, while equivalent paths with a superset of already-used trips are
// discarded. Unlike the legacy frontier search, this scan has no expansion or
// frontier cap.
function findOneWayReachableDestinationsCsa(records,stops,origin,date,options,allowed,limits){
  const {departureCutoff=null,connectionSettings=null}=options;
  const diagnostics=routeSearchDiagnostics(limits);
  const start=parisStartOfDay(date),dayEnd=parisEndOfDay(date),arrivalEnd=options.mode==='daytrip'?dayEnd:parisEndOfDay(addServiceDays(date,1));
  const cutoff=departureCutoff?new Date(departureCutoff):null;
  const connections=records.map(normalizeMax).filter(leg=>leg?.available&&leg.from>=start&&leg.from<=dayEnd&&leg.to<=arrivalEnd&&(!cutoff||leg.from>=cutoff)&&stationNodeKey(leg.origin)!==stationNodeKey(leg.destination));
  connections.sort((a,b)=>a.from-b.from||a.to-b.to||String(a.id).localeCompare(String(b.id)));
  const connectionsByOrigin=new Map();
  for(const leg of connections){const key=transferNodeKey(leg.origin);if(!connectionsByOrigin.has(key))connectionsByOrigin.set(key,[]);connectionsByOrigin.get(key).push(leg);}

  const nodes=new Map();
  for(const stop of stops){
    if(!stop.stop_lat||!stop.stop_lon||stop.parent_station)continue;
    const lat=Number(stop.stop_lat),lon=Number(stop.stop_lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon))continue;
    const key=stationNodeKey(stop.stop_name);
    if(!nodes.has(key))nodes.set(key,{names:[],points:[]});
    nodes.get(key).names.push(stop.stop_name);
    nodes.get(key).points.push({lat,lon});
  }
  for(const leg of connections)for(const [name,code] of [[leg.origin,leg.originIata],[leg.destination,leg.destinationIata]]){
    const point=coordinatesForIataCode(code),key=stationNodeKey(name);
    if(point&&!nodes.has(key))nodes.set(key,{names:[name],points:[point]});
  }

  const makeJourney=path=>({legs:path,departure:path[0].from,arrival:path.at(-1).to,duration:(path.at(-1).to-path[0].from)/60000,changes:journeyChangeCount(path),maxLegs:path.length,paidLegs:0,sameTrainReboard:path.some((leg,index)=>path.slice(0,index).some(previous=>journeyTripKey(previous)===journeyTripKey(leg)))});
  const tripKeys=[...new Set(connections.map(journeyTripKey))],tripBits=new Map(tripKeys.map((key,index)=>[key,1n<<BigInt(index)])),bestByNode=new Map(),outboundCompatibilityCache=new Map();
  const addLabel=(map,leg,path,usedMask)=>{
    const node=transferNodeKey(leg.destination);
    if(!map.has(node))map.set(node,new Map());
    // Routing forward only needs the previous service's transfer attributes
    // and arrival instant. Feed rows with different origins but the same
    // service, endpoint, and arrival can therefore share one label bucket.
    const byConnection=map.get(node),connectionId=[journeyTripKey(leg),stationNodeKey(leg.destination),leg.to.getTime(),leg.destinationUic||'',leg.connectionMode||'F',leg.connectionType||'',leg.connectionRics||''].join('|'),existing=byConnection.get(connectionId)||[];
    if(existing.some(label=>(label.usedMask&usedMask)===label.usedMask)){diagnostics.labelsPruned++;return false;}
    const survivors=existing.filter(label=>(usedMask&label.usedMask)!==usedMask);
    diagnostics.labelsPruned+=existing.length-survivors.length;
    survivors.push({path,usedMask});byConnection.set(connectionId,survivors);
    return true;
  };
  const recordDestination=(path)=>{
    const last=path.at(-1),key=stationNodeKey(last.destination),changes=journeyChangeCount(path);
    if(stationMatchesSelection(origin,last.destination)||!nodes.has(key)||!allowed.includes(changes))return;
    const journey=makeJourney(path);
    rememberOutboundCandidate(bestByNode,key,journey,{preserveReturnAlternatives:options.mode==='daytrip',connectionSettings,returnLegs:options.returnFromMap?.get(transferNodeKey(last.destination))||[],compatibilityCache:outboundCompatibilityCache});
  };

  const maxSegments=Math.max(1,Number(options.searchLimits?.maxSegments)||30),maxChanges=Math.max(...allowed);
  let previous=new Map();
  for(const leg of connections){
    if(!stationMatchesSelection(origin,leg.origin))continue;
    const path=[leg];
    addLabel(previous,leg,path,tripBits.get(journeyTripKey(leg)));recordDestination(path);
  }
  for(let ride=2;ride<=maxSegments&&previous.size;ride++){
    const current=new Map();
    for(const [origin,predecessors] of previous){
      for(const next of connectionsByOrigin.get(origin)||[])for(const labels of predecessors.values())for(const label of labels){
        diagnostics.expanded++;
        const path=label.path,last=path.at(-1);
        const nextTrip=journeyTripKey(next),lastTrip=journeyTripKey(last),nextBit=tripBits.get(nextTrip);
        if(next.from<last.to||nextTrip!==lastTrip&&(label.usedMask&nextBit)!==0n||stationNodeKey(next.destination)===stationNodeKey(last.destination))continue;
        const extended=[...path,next],changes=journeyChangeCount(extended);
        if(changes>maxChanges||!connectionGapAllowed(last,next,{connectionSettings}))continue;
        const usedMask=nextTrip===lastTrip?label.usedMask:label.usedMask|nextBit;
        if(addLabel(current,next,extended,usedMask))recordDestination(extended);
      }
    }
    previous=current;
  }
  if(previous.size)markSearchTruncated(diagnostics,'segment count limit');
  diagnostics.resultCount=bestByNode.size;
  if(options.csaOutboundOnly)return{bestByNode,diagnostics};

  const results=[];
  for(const [key,byChanges] of bestByNode){
    const choices=[...byChanges.entries()].map(([changes,candidates])=>[changes,[...candidates.values()].sort((a,b)=>a.arrival-b.arrival||a.departure-b.departure)[0]]).sort((a,b)=>a[0]-b[0]);
    const [changes,outbound]=choices[0],node=nodes.get(key),point=node.points.reduce((sum,current)=>({lat:sum.lat+current.lat,lon:sum.lon+current.lon}),{lat:0,lon:0});
    results.push({key,name:outbound.legs.at(-1).destination,lat:point.lat/node.points.length,lon:point.lon/node.points.length,changes,outbound,returning:null});
  }
  const sorted=results.sort((a,b)=>a.changes-b.changes||a.outbound.arrival-b.outbound.arrival||a.name.localeCompare(b.name));
  diagnostics.resultCount=sorted.length;
  return maybeIncludeSearchDiagnostics(sorted,options,diagnostics,'destinations');
}
export function findReachableDestinationOptions(records,origin,destination,date,options={}){
  const {mode='oneway',returnDate=date,changes=[0,1,2],limit=12,departureCutoff=null,connectionSettings=null,minimumStayMinutes=180}=options,limits={...DEFAULT_ROUTE_SEARCH_LIMITS,...options.searchLimits,expanded:routeSearchCap(options.searchLimits?.expanded,DEFAULT_ROUTE_SEARCH_LIMITS.expanded),frontier:routeSearchCap(options.searchLimits?.frontier,DEFAULT_ROUTE_SEARCH_LIMITS.frontier),returnExpanded:routeSearchCap(options.searchLimits?.returnExpanded,DEFAULT_ROUTE_SEARCH_LIMITS.returnExpanded),returnFrontier:routeSearchCap(options.searchLimits?.returnFrontier,DEFAULT_ROUTE_SEARCH_LIMITS.returnFrontier)},diagnostics=routeSearchDiagnostics(limits),target=stationNodeKey(destination),allowed=[...new Set(changes.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=5))].sort((a,b)=>a-b),maxChanges=Math.max(0,...allowed),start=parisStartOfDay(date),dayEnd=parisEndOfDay(date),outboundArrivalEnd=mode==='daytrip'?dayEnd:parisEndOfDay(addServiceDays(date,1));
  if(!allowed.length||stationMatchesSelection(origin,destination))return maybeIncludeSearchDiagnostics([],options,diagnostics,'options');
  const returnDay=mode==='return'?returnDate:date,returnStart=parisStartOfDay(returnDay),returnDayEnd=parisEndOfDay(returnDay),returnArrivalEnd=mode==='return'?parisEndOfDay(addServiceDays(returnDay,1)):returnDayEnd;
  const cutoff=departureCutoff?new Date(departureCutoff):null,available=records.map(normalizeMax).filter(leg=>leg?.available&&stationKey(leg.origin)!==stationKey(leg.destination)),outboundLegs=available.filter(leg=>leg.from>=start&&(!cutoff||leg.from>=cutoff)&&leg.from<=outboundArrivalEnd&&leg.to<=outboundArrivalEnd),returnLegs=mode==='daytrip'?available.filter(leg=>leg.from>=returnStart&&leg.from<=returnDayEnd&&leg.to<=returnDayEnd):mode==='return'?available.filter(leg=>leg.from>=returnStart&&leg.from<=returnArrivalEnd&&leg.to<=returnArrivalEnd):[];
  const fromMap=connectionIndexFor(outboundLegs),returnFromMap=connectionIndexFor(returnLegs),outboundLabelIndex=new Map(),outboundLabelOptions={keepFirstDeparture:true},maximumSegments=Math.max(1,Number(options.searchLimits?.maxSegments)||30),makeJourney=path=>({legs:path,departure:path[0].from,arrival:path.at(-1).to,duration:(path.at(-1).to-path[0].from)/60000,changes:journeyChangeCount(path),maxLegs:path.length,paidLegs:0});
  const isTarget=leg=>stationMatchesSelection(destination,leg.destination),candidates=new Map();let frontier=filterRouteLabels(outboundLegs.filter(leg=>leg.from<=dayEnd&&leg.to<=outboundArrivalEnd&&stationMatchesSelection(origin,leg.origin)).map(leg=>[leg]),outboundLabelIndex,{...outboundLabelOptions,connectionSettings,diagnostics});frontier=capRouteFrontier(frontier,limits.frontier,diagnostics);
  for(let depth=0;depth<maximumSegments&&frontier.length;depth++){
    for(const path of frontier){const last=path.at(-1),count=journeyChangeCount(path);if(isTarget(last)){if(allowed.includes(count)){const journey=makeJourney(path),key=path[0].from.getTime(),prior=candidates.get(key);if(!prior||journey.changes<prior.outbound.changes||journey.changes===prior.outbound.changes&&journey.arrival<prior.outbound.arrival)candidates.set(key,{outbound:journey});}continue;}}
    if(depth===maximumSegments-1){if(frontier.length)markSearchTruncated(diagnostics,'segment count limit');break;}
    const expanded=expandRouteFrontier(frontier,fromMap,{diagnostics,maxExpanded:limits.expanded,maxFrontier:limits.frontier,connectionSettings,labelIndex:outboundLabelIndex,labelOptions:outboundLabelOptions,canConnect:(path,last,next)=>!isTarget(last)&&journeyChangeCount([...path,next])<=maxChanges&&next.from<=outboundArrivalEnd&&next.to<=outboundArrivalEnd&&!reusesEarlierTrip(path,next)&&stationNodeKey(next.destination)!==stationNodeKey(last.destination)});
    frontier=expanded.frontier;if(expanded.stopped)break;
  }
  const findReturn=(arrivedAt,arrivalStation,outboundJourney)=>{
    const latestArrival=mode==='return'?returnArrivalEnd:returnDayEnd,minStay=mode==='daytrip'?Math.max(0,Number(minimumStayMinutes)||0):0,returnDiagnostics=routeSearchDiagnostics(limits),returnLabelIndex=new Map(),returnLabelOptions={latestDeparture:true};let paths=filterRouteLabels((returnFromMap.get(transferNodeKey(arrivalStation))||[]).filter(leg=>{const gap=(leg.from-arrivedAt)/60000,minimum=connectionMinimum(outboundJourney.legs.at(-1),leg,{connectionSettings});return!minimum.forbidden&&gap>=Math.max(minStay,minimum.minutes)&&leg.from<=returnDayEnd&&leg.to<=latestArrival;}).sort((a,b)=>b.from-a.from).map(leg=>[leg]),returnLabelIndex,{...returnLabelOptions,connectionSettings,diagnostics:returnDiagnostics});paths=capRouteFrontier(paths,limits.returnFrontier,returnDiagnostics,'frontierPeak','return frontier limit');diagnostics.returnSearches++;
    for(let depth=0;depth<maximumSegments&&paths.length;depth++){
      for(const path of paths){const last=path.at(-1),count=journeyChangeCount(path);if(stationMatchesSelection(origin,last.destination)&&allowed.includes(count)){diagnostics.returnExpanded+=returnDiagnostics.expanded;diagnostics.returnFrontierPeak=Math.max(diagnostics.returnFrontierPeak,returnDiagnostics.frontierPeak);diagnostics.returnFrontierCandidatesPeak=Math.max(diagnostics.returnFrontierCandidatesPeak,returnDiagnostics.frontierCandidatesPeak);diagnostics.labelsPruned+=returnDiagnostics.labelsPruned;if(returnDiagnostics.truncated)markSearchTruncated(diagnostics,returnDiagnostics.truncationReasons.includes('return frontier limit')?'return frontier limit':'return expansion limit');return makeJourney(path);}}
      if(depth===maximumSegments-1){if(paths.length)markSearchTruncated(returnDiagnostics,'segment count limit');break;}
      const expanded=expandRouteFrontier(paths,returnFromMap,{diagnostics:returnDiagnostics,maxExpanded:limits.returnExpanded,maxFrontier:limits.returnFrontier,connectionSettings,frontierReason:'return frontier limit',labelIndex:returnLabelIndex,labelOptions:returnLabelOptions,canConnect:(path,last,next)=>next.from<=latestArrival&&next.to<=latestArrival&&!reusesEarlierTrip(path,next)&&journeyChangeCount([...path,next])<=maxChanges&&stationNodeKey(next.destination)!==stationNodeKey(last.destination)});
      paths=expanded.frontier;if(expanded.stopped)break;
    }
    diagnostics.returnExpanded+=returnDiagnostics.expanded;diagnostics.returnFrontierPeak=Math.max(diagnostics.returnFrontierPeak,returnDiagnostics.frontierPeak);diagnostics.returnFrontierCandidatesPeak=Math.max(diagnostics.returnFrontierCandidatesPeak,returnDiagnostics.frontierCandidatesPeak);diagnostics.labelsPruned+=returnDiagnostics.labelsPruned;if(returnDiagnostics.truncated)markSearchTruncated(diagnostics,returnDiagnostics.truncationReasons.includes('return frontier limit')?'return frontier limit':'return expansion limit');return null;
  };
  let results=[...candidates.values()].sort((a,b)=>a.outbound.departure-b.outbound.departure||a.outbound.arrival-b.outbound.arrival);
  if(mode!=='oneway')results=results.map(option=>({...option,returning:findReturn(option.outbound.arrival,option.outbound.legs.at(-1).destination,option.outbound)})).filter(option=>option.returning);
  const resultLimit=Math.max(1,Math.min(20,Number(limit)||12));diagnostics.resultCount=results.length;diagnostics.resultLimit=resultLimit;diagnostics.resultsLimited=results.length>resultLimit;results=results.slice(0,resultLimit);
  return maybeIncludeSearchDiagnostics(results,options,diagnostics,'options');
}
export function sampleData(date='2026-10-07',returnDate=date){
 const makeAvailability=day=>[['6701','Paris Gare de Lyon','Lyon Part Dieu','07:00','08:56','OUI'],['6805','Lyon Part Dieu','Avignon TGV','09:10','10:12','OUI'],['6810','Avignon TGV','Marseille Saint Charles','10:25','11:00','OUI'],['6800','Marseille Saint Charles','Lyon Part Dieu','18:00','19:40','OUI'],['890123','Lyon Part Dieu','Avignon Centre','20:00','22:00','NON']].map(([train_no,origine,destination,heure_depart,heure_arrivee,od_happy_card])=>({date:day,train_no,origine,destination,heure_depart,heure_arrivee,od_happy_card}));const availability=[...makeAvailability(date),...(returnDate!==date?[{date:returnDate,train_no:'8700',origine:'Marseille Saint Charles',destination:'Lyon Part Dieu',heure_depart:'17:00',heure_arrivee:'18:40',od_happy_card:'OUI'},{date:returnDate,train_no:'8705',origine:'Lyon Part Dieu',destination:'Paris Gare de Lyon',heure_depart:'19:00',heure_arrivee:'21:00',od_happy_card:'OUI'}]:[])];
 const names=['Paris Gare de Lyon','Lyon Part Dieu','Avignon TGV','Marseille Saint Charles','Avignon Centre'],coords=[[48.844,2.373],[45.76,4.86],[43.92,4.786],[43.303,5.381],[43.94,4.81]],stops=names.map((stop_name,i)=>({stop_id:`s${i}`,stop_name,location_type:'1',stop_lat:String(coords[i][0]),stop_lon:String(coords[i][1])})),routes=[{route_id:'rmax',route_type:'2',route_short_name:'TGV INOUI'},{route_id:'ter',route_type:'109',route_short_name:'TER'}],trips=[['t6701','rmax','6701'],['t6805','rmax','6805'],['t6810','rmax','6810'],['t6800','rmax','6800'],['t8700','rmax','8700'],['t8705','rmax','8705'],['terx','ter','TER 123']].map(([trip_id,route_id,trip_short_name])=>({trip_id,route_id,service_id:'all',trip_short_name}));const points=[['t6701','s0','07:00:00','07:00:00'],['t6701','s1','08:56:00','08:56:00'],['t6805','s1','09:10:00','09:10:00'],['t6805','s2','10:12:00','10:12:00'],['t6810','s2','10:25:00','10:25:00'],['t6810','s3','11:00:00','11:00:00'],['t6800','s3','18:00:00','18:00:00'],['t6800','s1','19:40:00','19:40:00'],['t8700','s3','17:00:00','17:00:00'],['t8700','s1','18:40:00','18:40:00'],['t8705','s1','19:00:00','19:00:00'],['t8705','s0','21:00:00','21:00:00'],['terx','s1','20:00:00','20:00:00'],['terx','s4','22:00:00','22:00:00']],stopTimes=points.map(([trip_id,stop_id,arrival_time,departure_time],i)=>({trip_id,stop_id,stop_sequence:'1',arrival_time,departure_time}));const grouped=new Map();for(const row of stopTimes){if(!grouped.has(row.trip_id))grouped.set(row.trip_id,[]);grouped.get(row.trip_id).push(row);}for(const rows of grouped.values())rows.forEach((row,i)=>row.stop_sequence=String(i+1));const calendar=[{service_id:'all',start_date:'20260101',end_date:'20271231',sunday:'1',monday:'1',tuesday:'1',wednesday:'1',thursday:'1',friday:'1',saturday:'1'}];return{availability,tables:{stops,routes,trips,stopTimes,calendar,calendarDates:[]}};
}
