class GPSProvider {
  async getVehicles() {
    throw new Error('GPSProvider.getVehicles() must be implemented by a concrete provider.');
  }
}

class MockGPSProvider extends GPSProvider {
  async getVehicles() {
    const now = new Date().toISOString();
    return [
      { vehicle: 'BR-07', crew: 'Аварийная бригада 07', lat: 53.2144, lon: 63.6241, speed: 18, status: 'EN_ROUTE', last_update: now },
      { vehicle: 'BR-12', crew: 'Бригада 12', lat: 53.2208, lon: 63.6320, speed: 6, status: 'AVAILABLE', last_update: now },
      { vehicle: 'BR-03', crew: 'Аварийная бригада 03', lat: 53.2091, lon: 63.6187, speed: 14, status: 'WORKING', last_update: now }
    ];
  }
}

class HeatMeterProvider {
  async getConsumption() {
    throw new Error('HeatMeterProvider.getConsumption() must be implemented by a concrete provider.');
  }
}

class MockHeatMeterProvider extends HeatMeterProvider {
  async getConsumption() {
    const now = Date.now();
    return [
      { object_id: 'house-01', parameter: 'heat_consumption', value: 4.8, unit: 'Gcal', timestamp: new Date(now).toISOString(), source: 'mock', quality: 'estimated' },
      { object_id: 'house-02', parameter: 'heat_consumption', value: 5.1, unit: 'Gcal', timestamp: new Date(now - 300000).toISOString(), source: 'mock', quality: 'estimated' },
      { object_id: 'house-03', parameter: 'heat_consumption', value: 3.7, unit: 'Gcal', timestamp: new Date(now - 600000).toISOString(), source: 'mock', quality: 'estimated' }
    ];
  }
}

module.exports = {
  GPSProvider,
  MockGPSProvider,
  HeatMeterProvider,
  MockHeatMeterProvider
};
