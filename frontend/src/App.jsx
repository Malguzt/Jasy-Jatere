import React, { useEffect, useState } from 'react';
import Scanner from './components/Scanner';
import CameraList from './components/CameraList';
import CameraDetailsModal from './components/CameraDetailsModal';
import Dashboard from './components/Dashboard';
import Recordings from './components/Recordings';
import ConnectivityMonitor from './components/ConnectivityMonitor';
import MapView from './components/MapView';
import { Search, Plus, LayoutDashboard, Radar, Video, Activity, Map as MapIcon } from 'lucide-react';
import './index.css';

function App() {
  const parseTabFromHash = () => {
    const hash = (window.location.hash || '').replace(/^#/, '');
    const raw = hash.startsWith('/') ? hash.slice(1) : hash;
    if (['radar', 'dashboard', 'monitoring', 'map', 'recordings'].includes(raw)) return raw;
    return 'radar';
  };

  const [activeTab, setActiveTab] = useState(parseTabFromHash);
  const [cameras, setCameras] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);

  const navigateToTab = (tab) => {
    const next = ['radar', 'dashboard', 'monitoring', 'map', 'recordings'].includes(tab) ? tab : 'radar';
    if (window.location.hash !== `#/${next}`) {
      window.history.pushState({}, '', `#/${next}`);
    }
    setActiveTab(next);
  };

  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState({}, '', '#/radar');
    } else {
      setActiveTab(parseTabFromHash());
    }
    const onHashChange = () => setActiveTab(parseTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const startScan = async () => {
    navigateToTab('radar');
    setIsScanning(true);
    setCameras([]);
    try {
      const res = await fetch('/api/discover');
      const data = await res.json();
      if(data.success) {
         setCameras(data.devices);
      } else {
         alert('Error scanning: ' + data.error);
      }
    } catch (error) {
       console.error(error);
       alert('Error de conexión con el backend. Asegúrate de que el servidor está corriendo.');
    }
    setIsScanning(false);
  };

  const handleManualEntry = () => {
      setSelectedCamera({
          name: 'Conexión Manual (ONVIF)',
          address: 'http://192.168.1.X:80/onvif/device_service'
      });
  };

  const isDashboard = activeTab === 'dashboard' || activeTab === 'monitoring' || activeTab === 'map';

  return (
    <div className={isDashboard ? 'app-fullscreen' : 'container'}>
      {/* Compact toolbar in dashboard mode, full header in radar */}
      {isDashboard ? (
        <div className="dash-toolbar">
          <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--accent-color)' }}>IP Cam</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button className="toolbar-btn" style={{ opacity: activeTab === 'radar' ? 1 : 0.5 }} onClick={() => navigateToTab('radar')}>
              <Radar size={13} /> Explorar
            </button>
            <button 
              className={`toolbar-btn ${activeTab === 'dashboard' ? 'active' : ''}`} 
              style={{ opacity: activeTab === 'dashboard' ? 1 : 0.5 }}
              onClick={() => navigateToTab('dashboard')}
            >
              <LayoutDashboard size={13} /> Dashboard
            </button>
            <button 
              className={`toolbar-btn ${activeTab === 'monitoring' ? 'active' : ''}`} 
              style={{ opacity: activeTab === 'monitoring' ? 1 : 0.5 }}
              onClick={() => navigateToTab('monitoring')}
            >
              <Activity size={13} /> Monitoreo
            </button>
            <button
              className={`toolbar-btn ${activeTab === 'map' ? 'active' : ''}`}
              style={{ opacity: activeTab === 'map' ? 1 : 0.5 }}
              onClick={() => navigateToTab('map')}
            >
              <MapIcon size={13} /> Mapa
            </button>
            <button 
              className={`toolbar-btn ${activeTab === 'recordings' ? 'active' : ''}`} 
              style={{ opacity: activeTab === 'recordings' ? 1 : 0.5 }}
              onClick={() => navigateToTab('recordings')}
            >
              <Video size={13} /> Grabaciones
            </button>
          </div>
        </div>
      ) : (
        <header style={{ animation: 'fadeIn 1s ease-out' }}>
          <h1 className="title">IP Camera Explorer</h1>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1.5rem', marginBottom: '1.2rem' }}>
              <button className="btn" style={{ borderColor: activeTab === 'radar' ? 'var(--accent-color)' : 'rgba(255,255,255,0.2)', color: activeTab === 'radar' ? 'var(--accent-color)' : '#fff', opacity: activeTab === 'radar' ? 1 : 0.6 }} onClick={() => navigateToTab('radar')}>
                  <Radar size={18} /> Explorar / Buscar
              </button>
              <button className="btn" style={{ borderColor: activeTab === 'dashboard' ? 'var(--accent-color)' : 'rgba(255,255,255,0.2)', color: activeTab === 'dashboard' ? 'var(--accent-color)' : '#fff', opacity: activeTab === 'dashboard' ? 1 : 0.6 }} onClick={() => navigateToTab('dashboard')}>
                  <LayoutDashboard size={18} /> Mi Dashboard
              </button>
              <button className="btn" style={{ borderColor: activeTab === 'recordings' ? 'var(--accent-color)' : 'rgba(255,255,255,0.2)', color: activeTab === 'recordings' ? 'var(--accent-color)' : '#fff', opacity: activeTab === 'recordings' ? 1 : 0.6 }} onClick={() => navigateToTab('recordings')}>
                  <Video size={18} /> Grabaciones
              </button>
              <button className="btn" style={{ borderColor: activeTab === 'monitoring' ? 'var(--accent-color)' : 'rgba(255,255,255,0.2)', color: activeTab === 'monitoring' ? 'var(--accent-color)' : '#fff', opacity: activeTab === 'monitoring' ? 1 : 0.6 }} onClick={() => navigateToTab('monitoring')}>
                  <Activity size={18} /> Monitoreo
              </button>
              <button className="btn" style={{ borderColor: activeTab === 'map' ? 'var(--accent-color)' : 'rgba(255,255,255,0.2)', color: activeTab === 'map' ? 'var(--accent-color)' : '#fff', opacity: activeTab === 'map' ? 1 : 0.6 }} onClick={() => navigateToTab('map')}>
                  <MapIcon size={18} /> Mapa
              </button>
          </div>
        </header>
      )}

      {activeTab === 'dashboard' ? (
          <Dashboard />
      ) : activeTab === 'monitoring' ? (
          <ConnectivityMonitor />
      ) : activeTab === 'map' ? (
          <MapView />
      ) : activeTab === 'recordings' ? (
          <Recordings />
      ) : (
          <>
            {!isScanning && cameras.length === 0 && (
               <div style={{ textAlign: 'center', marginTop: '4rem', animation: 'fadeIn 1s ease-out' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                      <button className="btn" onClick={startScan}>
                         <Search size={22} />
                         Iniciar Análisis de Red
                      </button>
                      <button className="btn" style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#fff' }} onClick={handleManualEntry}>
                         <Plus size={22} />
                         Conexión Manual IP
                      </button>
                  </div>
                  <p style={{ marginTop: '1.5rem', opacity: 0.6, fontSize: '0.9rem' }}>
                    Detectará automáticamente cámaras compatibles con ONVIF mediante WS-Discovery.
                  </p>
               </div>
            )}

            {isScanning && <Scanner />}

            {!isScanning && cameras.length > 0 && (
              <>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem'}}>
                   <h2 style={{color: '#fff', fontWeight: 600}}>Resultados de Escaneo ({cameras.length})</h2>
                   <div style={{ display: 'flex', gap: '1rem' }}>
                       <button className="btn" style={{ borderColor: 'rgba(255,255,255,0.4)', color: '#fff', padding: '0.5rem 1rem' }} onClick={handleManualEntry}>
                           <Plus size={18} /> Manual
                       </button>
                       <button className="btn" style={{ padding: '0.5rem 1rem' }} onClick={startScan}>
                           <Search size={18} /> Reanalizar
                       </button>
                   </div>
                </div>
                <CameraList cameras={cameras} onSelect={setSelectedCamera} />
              </>
            )}

            {selectedCamera && (
               <CameraDetailsModal camera={selectedCamera} onClose={() => setSelectedCamera(null)} />
            )}
          </>
      )}
    </div>
  );
}

export default App;
