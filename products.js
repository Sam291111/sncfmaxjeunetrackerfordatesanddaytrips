const routeLabel = route => `${route?.route_short_name||''} ${route?.route_long_name||''} ${route?.route_desc||''}`.toUpperCase();

export function isRail(route={}) {
  const type=Number(route.route_type);
  return type===2||(type>=100&&type<200);
}

export function isTimetableConnection(route={}) {
  return isRail(route)||Number(route.route_type)===3;
}

export function routeName(route={}) {
  const label=routeLabel(route),type=Number(route.route_type);
  if(type===3)return'Bus / coach connection (paid)';
  if(/\bTER\b/.test(label)||(type>=100&&type<200))return 'TER / regional connection (paid)';
  if(/TGV|OUIGO|INTERCIT[EÉ]S/.test(label))return 'TGV / Intercités (paid; MAX not shown)';
  return 'Paid rail (MAX not shown)';
}

export function isMaxTgvOrIntercites(route={}) {
  return /TGV|OUIGO|INTERCIT[EÉ]S/.test(routeLabel(route));
}

export function connectionProduct(route={},trip={}) {
  const label=`${routeLabel(route)} ${trip.trip_id||''}`.toUpperCase();
  if(isOuigoTrip(trip)||/OUIGO/.test(label))return'OUIGO';
  if(Number(route.route_type)===3)return'BUS';
  if(/\bTER\b/.test(label)||(Number(route.route_type)>=100&&Number(route.route_type)<200))return'TER';
  if(/INTERCIT[EÉ]S/.test(label))return'INTERCITES';
  if(/TGV/.test(label))return'TGV';
  return'';
}

function isOuigoTrip(trip) {
  return /_F:OGO:/i.test(String(trip?.trip_id||''));
}

export function classifyOuigo(trip,train) {
  if(!isOuigoTrip(trip))return null;
  const number=Number(train);
  if(number>=7000&&number<8000)return{category:'grand-vitesse',maxStatus:'candidate'};
  if(number>=4000&&number<5000)return{category:'classique',maxStatus:'ineligible'};
  return{category:'unknown',maxStatus:'unknown'};
}
