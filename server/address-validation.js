const GOOGLE_VALIDATE_ENDPOINT = 'https://addressvalidation.googleapis.com/v1:validateAddress';

function clean(value, max = 160) {
  return String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);
}

function addressRequest(buyer) {
  return {
    address: {
      regionCode: clean(buyer.country || 'US', 2).toUpperCase(),
      administrativeArea: clean(buyer.state, 40),
      locality: clean(buyer.city, 80),
      postalCode: clean(buyer.zip, 20),
      addressLines: [clean(buyer.address1), clean(buyer.address2)].filter(Boolean),
    },
    enableUspsCass: clean(buyer.country || 'US', 2).toUpperCase() === 'US',
  };
}

function normalizedBuyer(original, postalAddress) {
  const addressLines = Array.isArray(postalAddress && postalAddress.addressLines)
    ? postalAddress.addressLines.map(line => clean(line)).filter(Boolean)
    : [];
  return {
    ...original,
    address1: addressLines[0] || original.address1,
    address2: addressLines.length > 1 ? addressLines.slice(1).join(', ') : original.address2,
    city: clean(postalAddress && (postalAddress.locality || postalAddress.sublocality), 80) || original.city,
    state: clean(postalAddress && postalAddress.administrativeArea, 40).toUpperCase() || original.state,
    zip: clean(postalAddress && postalAddress.postalCode, 20).toUpperCase() || original.zip,
    country: clean(postalAddress && postalAddress.regionCode, 2).toUpperCase() || original.country,
  };
}

function invalidResult(code, error, details = {}) {
  return { enabled: true, valid: false, code, error, ...details };
}

function interpretValidationResponse(buyer, payload) {
  const result = payload && payload.result;
  const verdict = result && result.verdict;
  const address = result && result.address;
  const uspsData = result && result.uspsData;
  if (!result || !verdict || !address) {
    return invalidResult('address_validation_unavailable', 'We could not verify this address right now. Please try again in a moment.', { status: 503 });
  }

  const missing = Array.isArray(address.missingComponentTypes) ? address.missingComponentTypes : [];
  const unconfirmed = Array.isArray(address.unconfirmedComponentTypes) ? address.unconfirmedComponentTypes : [];
  const unresolved = Array.isArray(address.unresolvedTokens) ? address.unresolvedTokens : [];
  const isUs = String(buyer.country || '').toUpperCase() === 'US';
  const dpv = uspsData && uspsData.dpvConfirmation;

  if (isUs && (missing.includes('subpremise') || dpv === 'D')) {
    return invalidResult('missing_unit', 'This building needs an apartment, suite, or unit number. Add it to Address Line 2, then try again.', { field: 'address2', status: 400 });
  }
  if (isUs && (unconfirmed.includes('subpremise') || dpv === 'S')) {
    return invalidResult('invalid_unit', 'We could not verify that apartment, suite, or unit number. Check Address Line 2 and try again.', { field: 'address2', status: 400 });
  }

  const acceptableGranularity = new Set(['PREMISE', 'SUB_PREMISE']);
  const invalidDpv = isUs && dpv && !['Y', 'D', 'S'].includes(dpv);
  if (
    verdict.addressComplete !== true
    || verdict.hasUnconfirmedComponents === true
    || missing.length > 0
    || unconfirmed.length > 0
    || unresolved.length > 0
    || !acceptableGranularity.has(verdict.validationGranularity)
    || invalidDpv
  ) {
    return invalidResult('invalid_address', 'We could not verify that delivery address. Choose a suggested street address or correct the street, city, state, and ZIP code.', { field: 'address1', status: 400 });
  }

  return {
    enabled: true,
    valid: true,
    buyer: normalizedBuyer(buyer, address.postalAddress || {}),
    responseId: clean(payload.responseId, 100),
    validationGranularity: verdict.validationGranularity,
  };
}

async function validateShippingAddress(buyer, options = {}) {
  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) return { enabled: false, valid: true, buyer };
  const fetchImpl = options.fetchImpl || fetch;
  let response;
  try {
    response = await fetchImpl(`${GOOGLE_VALIDATE_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(addressRequest(buyer)),
    });
  } catch (_) {
    return invalidResult('address_validation_unavailable', 'We could not verify this address right now. Please try again in a moment.', { status: 503 });
  }
  if (!response.ok) {
    return invalidResult('address_validation_unavailable', 'We could not verify this address right now. Please try again in a moment.', { status: 503 });
  }
  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    return invalidResult('address_validation_unavailable', 'We could not verify this address right now. Please try again in a moment.', { status: 503 });
  }
  return interpretValidationResponse(buyer, payload);
}

module.exports = {
  addressRequest,
  interpretValidationResponse,
  validateShippingAddress,
};
