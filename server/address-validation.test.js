const test = require('node:test');
const assert = require('node:assert/strict');
const { addressRequest, censusAddressUrl, interpretCensusResponse, interpretValidationResponse, validateShippingAddress } = require('./address-validation');

const buyer = {
  name: 'July Customer',
  email: 'july@example.com',
  address1: '8044 La Crosse Ave',
  address2: '',
  city: 'Skokie',
  state: 'IL',
  zip: '60077',
  country: 'US',
};

test('Google address request is structured and enables USPS CASS for U.S. orders', () => {
  const request = addressRequest(buyer);
  assert.equal(request.enableUspsCass, true);
  assert.deepEqual(request.address.addressLines, ['8044 La Crosse Ave']);
  assert.equal(request.address.regionCode, 'US');
});

test('a complete premise is accepted and normalized for shipping labels', () => {
  const result = interpretValidationResponse(buyer, {
    responseId: 'validation-1',
    result: {
      verdict: { addressComplete: true, validationGranularity: 'PREMISE' },
      address: {
        postalAddress: {
          regionCode: 'US',
          administrativeArea: 'IL',
          locality: 'Skokie',
          postalCode: '60077-2527',
          addressLines: ['8044 LA CROSSE AVE'],
        },
        missingComponentTypes: [],
        unconfirmedComponentTypes: [],
        unresolvedTokens: [],
      },
      uspsData: { dpvConfirmation: 'Y' },
    },
  });
  assert.equal(result.valid, true);
  assert.equal(result.buyer.address1, '8044 LA CROSSE AVE');
  assert.equal(result.buyer.zip, '60077-2527');
  assert.equal(result.responseId, 'validation-1');
});

test('a U.S. building that needs a subpremise requires apartment or unit input', () => {
  const result = interpretValidationResponse(buyer, {
    result: {
      verdict: { addressComplete: false, validationGranularity: 'PREMISE' },
      address: { missingComponentTypes: ['subpremise'], unconfirmedComponentTypes: [], unresolvedTokens: [] },
      uspsData: { dpvConfirmation: 'D' },
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'missing_unit');
  assert.equal(result.field, 'address2');
});

test('unconfirmed or route-only addresses are rejected', () => {
  const result = interpretValidationResponse(buyer, {
    result: {
      verdict: { addressComplete: false, validationGranularity: 'ROUTE', hasUnconfirmedComponents: true },
      address: { missingComponentTypes: ['street_number'], unconfirmedComponentTypes: ['route'], unresolvedTokens: [] },
      uspsData: { dpvConfirmation: 'N' },
    },
  });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'invalid_address');
  assert.equal(result.field, 'address1');
});

test('Census fallback validates and standardizes U.S. addresses without a Google key', async () => {
  const result = await validateShippingAddress(buyer, {
    apiKey: '',
    fetchImpl: async url => {
      assert.match(url, /^https:\/\/geocoding\.geo\.census\.gov\/geocoder\/locations\/address\?/);
      return {
        ok: true,
        json: async () => ({
          result: {
            addressMatches: [{
              matchedAddress: '8044 LA CROSSE AVE, SKOKIE, IL, 60077',
              addressComponents: { city: 'SKOKIE', state: 'IL', zip: '60077' },
            }],
          },
        }),
      };
    },
  });
  assert.equal(result.enabled, true);
  assert.equal(result.valid, true);
  assert.equal(result.provider, 'census_geocoder');
  assert.equal(result.buyer.address1, '8044 LA CROSSE AVE');
  assert.equal(result.buyer.city, 'SKOKIE');
});

test('Census fallback rejects a U.S. address that does not match', () => {
  const result = interpretCensusResponse(buyer, { result: { addressMatches: [] } });
  assert.equal(result.valid, false);
  assert.equal(result.code, 'invalid_address');
});

test('Census requests omit apartment details but preserve the entered unit', () => {
  const withUnit = { ...buyer, address2: 'Apt 4B' };
  assert.doesNotMatch(censusAddressUrl(withUnit), /4B/);
  const result = interpretCensusResponse(withUnit, {
    result: {
      addressMatches: [{
        matchedAddress: '8044 LA CROSSE AVE, SKOKIE, IL, 60077',
        addressComponents: { city: 'SKOKIE', state: 'IL', zip: '60077' },
      }],
    },
  });
  assert.equal(result.buyer.address2, 'Apt 4B');
});

test('international checkout remains manual when Google is not configured', async () => {
  const internationalBuyer = { ...buyer, country: 'CA' };
  const result = await validateShippingAddress(internationalBuyer, { apiKey: '' });
  assert.equal(result.enabled, false);
  assert.equal(result.valid, true);
  assert.equal(result.provider, 'manual');
});
