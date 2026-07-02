/**
 * ASAP Loan App — County auto-fill (v3, reliable).
 *
 *   Primary : Geocodio (free API key, 2,500 lookups/day) — returns the county
 *             directly and resolves PARTIAL addresses (street-only or City + State).
 *   Fallback: U.S. Census (no key) — precise, but needs a full address w/ a house #.
 *
 * WHY THE KEY: the old no-key OpenStreetMap service rate-limits (about 1/second),
 * temporarily blocks bursts, and is often blocked outright from Google's servers.
 * A free Geocodio key removes all of that.
 *
 * ONE-TIME SETUP (about 2 minutes):
 *   1) Create a free account at  https://www.geocod.io   (no credit card).
 *   2) Copy your API key from the dashboard (Account -> API Keys).
 *   3) Paste it between the quotes on the GEOCODIO_KEY line below, then Save.
 *   4) Manage Deployments -> pencil -> New version -> Deploy.
 *
 * The key lives ONLY in this server-side file; it is never sent to the browser.
 * Don't share this file publicly once the key is filled in.
 */
var GEOCODIO_KEY = '567f65962536444769725975fa4442f476a57a5';   // <-- paste your free Geocodio API key between the quotes

function pipeline_countyFromAddress(address) {
  try {
    address = (address == null ? '' : String(address)).trim()
                .replace(/\s+/g, ' ').replace(/\s*,\s*,+/g, ', ');
    if (address.length < 4) return { ok: false, county: '' };

    var c = countyViaGeocodio_(address);
    if (c) return { ok: true, county: c, source: 'geocodio' };

    c = countyViaCensus_(address);
    if (c) return { ok: true, county: c, source: 'census' };

    return { ok: false, county: '' };
  } catch (err) {
    return { ok: false, county: '', error: String(err) };
  }
}

function countyViaGeocodio_(address) {
  try {
    if (!GEOCODIO_KEY) return '';
    var url = 'https://api.geocod.io/v1.7/geocode'
            + '?q='       + encodeURIComponent(address)
            + '&limit='   + '1'
            + '&api_key=' + encodeURIComponent(GEOCODIO_KEY);
    var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) return '';
    var data = JSON.parse(resp.getContentText() || '{}');
    var r = data && data.results && data.results[0];
    if (!r) return '';
    return cleanCounty_((r.address_components || {}).county || '');
  } catch (e) { return ''; }
}

function countyViaCensus_(address) {
  try {
    var url = 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress'
            + '?address=' + encodeURIComponent(address)
            + '&benchmark=Public_AR_Current&vintage=Current_Current&format=json';
    var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, followRedirects: true });
    if (resp.getResponseCode() !== 200) return '';
    var data = JSON.parse(resp.getContentText() || '{}');
    var m = data && data.result && data.result.addressMatches;
    if (!m || !m.length) return '';
    var geos = m[0].geographies || {};
    var counties = geos['Counties'] || geos['County'] || [];
    if (!counties.length) return '';
    return cleanCounty_(String(counties[0].BASENAME || counties[0].NAME || ''));
  } catch (e) { return ''; }
}

function cleanCounty_(name) {
  return String(name || '').replace(/\s+County\s*$/i, '').trim();
}