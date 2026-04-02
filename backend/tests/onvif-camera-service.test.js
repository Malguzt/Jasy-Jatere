const test = require('node:test');
const assert = require('node:assert/strict');

const { OnvifCameraService } = require('../src/domains/cameras/onvif-camera-service');

function makeOnvifStub({ startProbe, deviceFactory }) {
    class FakeDevice {
        constructor(config) {
            this.config = config;
            this.user = config.user;
            this.pass = config.pass;
            this.services = { ptz: { xaddr: 'http://camera.local/ptz' } };
        }

        async init() {}

        getProfileList() {
            return [];
        }

        getUdpStreamUrl() {
            return null;
        }

        getInformation() {
            return {};
        }

        async ptzMove() {}

        async ptzStop() {}

        async fetchSnapshot() {
            return Buffer.from('snapshot');
        }
    }

    return {
        startProbe: startProbe || (async () => []),
        OnvifDevice: deviceFactory || FakeDevice
    };
}

function makeService(overrides = {}) {
    const onvifLib = overrides.onvifLib || makeOnvifStub({});
    return new OnvifCameraService({
        onvifLib,
        onvifSoapModule: overrides.onvifSoapModule || {
            createRequestSoap: () => '<soap/>',
            requestCommand: async () => ({ ok: true })
        },
        fsModule: overrides.fsModule || {
            existsSync: () => false,
            readFileSync: () => '[]'
        },
        osModule: overrides.osModule || {
            networkInterfaces: () => ({})
        },
        netModule: overrides.netModule || {
            Socket: class {
                setTimeout() {}
                once() {}
                destroy() {}
                connect() {}
            }
        },
        fetchImpl: overrides.fetchImpl || (async () => ({ status: 404, text: async () => '' })),
        resolveUserPassFn: overrides.resolveUserPassFn || ((user, pass) => ({
            user: user || 'admin',
            pass: pass || 'secret'
        })),
        cameraInventoryService: overrides.cameraInventoryService,
        legacyFileFallbackEnabled: overrides.legacyFileFallbackEnabled,
        config: {
            discoverConcurrency: 1,
            discoverIpRange: '2-2',
            discoverPortsRaw: '80',
            ...overrides.config
        }
    });
}

test('discover returns ws-discovery results when probe finds devices', async () => {
    const service = makeService({
        onvifLib: makeOnvifStub({
            startProbe: async () => [
                {
                    urn: 'urn:camera-1',
                    name: 'Camera 1',
                    xaddrs: ['http://192.168.1.10/onvif/device_service'],
                    hardware: 'Cam-HW'
                }
            ]
        })
    });

    const result = await service.discover();
    assert.equal(result.method, 'ws-discovery');
    assert.equal(result.count, 1);
    assert.equal(result.devices[0].address, 'http://192.168.1.10/onvif/device_service');
});

test('discover uses active-scan-fallback when ws-discovery errors', async () => {
    const service = makeService({
        onvifLib: makeOnvifStub({
            startProbe: async () => {
                throw new Error('probe failed');
            }
        })
    });

    service.discoverByActiveScan = async () => ({
        devices: [
            {
                id: 0,
                urn: 'active-192.168.1.20-80',
                name: 'Fallback Camera',
                address: 'http://192.168.1.20:80/onvif/device_service',
                hardware: 'Unknown'
            }
        ],
        prefixes: ['192.168.1']
    });

    const result = await service.discover();
    assert.equal(result.method, 'active-scan-fallback');
    assert.equal(result.count, 1);
    assert.ok(result.warning.includes('probe failed'));
});

test('loadKnownIpPrefixes prefers inventory service and skips legacy file fallback when disabled', () => {
    let fileReads = 0;
    const service = makeService({
        cameraInventoryService: {
            listCameras: () => [
                { id: 'cam-1', ip: 'http://192.168.77.15/onvif/device_service' },
                { id: 'cam-2', rtspUrl: 'rtsp://admin:pass@192.168.88.20:554/onvif1' }
            ]
        },
        legacyFileFallbackEnabled: false,
        fsModule: {
            existsSync: () => true,
            readFileSync: () => {
                fileReads += 1;
                return '[]';
            }
        }
    });

    const prefixes = service.loadKnownIpPrefixes();
    assert.equal(prefixes.has('192.168.77'), true);
    assert.equal(prefixes.has('192.168.88'), true);
    assert.equal(fileReads, 0);
});

test('connect injects combined AI profile when at least one RTSP stream exists', async () => {
    class DeviceWithProfiles {
        constructor(config) {
            this.user = config.user;
            this.pass = config.pass;
            this.services = { ptz: { xaddr: 'http://camera.local/ptz' } };
        }

        async init() {}

        getProfileList() {
            return [
                {
                    name: 'Main',
                    token: 'profile-main',
                    video: {
                        encoder: {
                            resolution: { width: 1920, height: 1080 },
                            encoding: 'H.264'
                        }
                    }
                }
            ];
        }

        getUdpStreamUrl(token) {
            return `rtsp://camera.local/${token}`;
        }

        getInformation() {
            return { model: 'DemoCam' };
        }
    }

    const service = makeService({
        onvifLib: makeOnvifStub({
            deviceFactory: DeviceWithProfiles
        })
    });

    const result = await service.connect({
        url: 'http://camera.local/onvif/device_service',
        user: 'operator',
        pass: '1234'
    });

    assert.equal(result.ptz, true);
    assert.ok(result.profiles.some((profile) => profile.token === 'combined_ai'));
    assert.ok(result.profiles.some((profile) => profile.rtspUrl.includes('operator:1234@')));
});

test('toggleLight returns 400 error when profile token is missing', async () => {
    class DeviceWithoutProfiles {
        constructor(config) {
            this.user = config.user;
            this.pass = config.pass;
            this.services = { ptz: { xaddr: 'http://camera.local/ptz' } };
        }

        async init() {}

        getProfileList() {
            return [];
        }
    }

    const service = makeService({
        onvifLib: makeOnvifStub({
            deviceFactory: DeviceWithoutProfiles
        })
    });

    await assert.rejects(
        () => service.toggleLight({ url: 'http://camera.local/onvif/device_service', enabled: true }),
        (error) => Number(error?.status) === 400 && error.message.includes('ProfileToken')
    );
});
