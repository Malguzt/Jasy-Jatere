import React, { useState } from 'react';
import Scanner from './components/Scanner';
import CameraList from './components/CameraList';
import CameraDetailsModal from './components/CameraDetailsModal';
import Dashboard from './components/Dashboard';
import { Search, Plus, LayoutDashboard, Radar } from 'lucide-react';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState('radar');
  const [cameras, setCameras] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);

  const startScan = async () => {
    setActiveTab('radar');
    setIsScanning(true);
    setCameras([]);
    try {
      const res = await fetch('http://localhost:4000/api/discover');
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

  const isDashboard = activeTab === 'dashboard';

  return (
    <div className={isDashboard ? 'app-fullscreen' : 'container'}>
      {/* Compact toolbar in dashboard mode, full header in radar */}
      {isDashboard ? (
        <div className="dash-toolbar">
          <span style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--accent-color)' }}>IP Cam</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button className="toolbar-btn" style={{ opacity: 0.5 }} onClick={() => setActiveTab('radar')}>
              <Radar size={13} /> Explorar
            </button>
            <button className="toolbar-btn active">
              <LayoutDashboard size={13} /> Dashboard
            </button>
          </div>
        </div>
      ) : (
        <header style={{ animation: 'fadeIn 1s ease-out' }}>
          <h1 className="title">IP Camera Explorer</h1>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1.5rem', marginBottom: '2rem' }}>
              <button className="btn" style={{ borderColor: 'var(--accent-color)', color: 'var(--accent-color)' }} onClick={() => setActiveTab('radar')}>
                  <Radar size={18} /> Explorar / Buscar
              </button>
              <button className="btn" style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#fff', opacity: 0.6 }} onClick={() => setActiveTab('dashboard')}>
                  <LayoutDashboard size={18} /> Mi Dashboard
              </button>
          </div>
        </header>
      )}

      {isDashboard ? (
          <Dashboard />
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
