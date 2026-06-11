import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaGlobe, FaLock, FaHistory, FaTrash } from 'react-icons/fa';
import './Account.css'; // Reuse the account CSS layout

function Security() {
    const navigate = useNavigate();
    const token = localStorage.getItem('token');
    
    const [allHistory, setAllHistory] = useState([]);
    const [historyTimeframe, setHistoryTimeframe] = useState('all');
    const [isDeletingHistory, setIsDeletingHistory] = useState(false);
    
    const [publicFiles, setPublicFiles] = useState([]);
    const [isMakingAllPrivate, setIsMakingAllPrivate] = useState(false);
    
    const [status, setStatus] = useState({ message: '', type: '' });
    const API = import.meta.env.VITE_API_BASE_URL;

    const fetchPublicFiles = async () => {
        try {
            const res = await fetch(`${API}/api/files/public-list`, {
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setPublicFiles(data);
            }
        } catch (err) {}
    };

    const fetchAllHistory = async () => {
        try {
            const res = await fetch(`${API}/api/history`, {
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setAllHistory(data);
            }
        } catch (err) {}
    };

    useEffect(() => {
        if (!token) {
            navigate('/login');
            return;
        }
        fetchAllHistory();
        fetchPublicFiles();
    }, [token, navigate]);

    const handleMakePrivate = async (fileId) => {
        try {
            const res = await fetch(`${API}/api/files/makePrivate/${fileId}`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                setStatus({ message: "File is now private.", type: 'success' });
                fetchPublicFiles();
                setTimeout(() => setStatus({ message: '', type: '' }), 3000);
            }
        } catch (err) {}
    };

    const handleMakeAllPrivate = async () => {
        if (!window.confirm("Warning: This will break all active sharing links. Continue?")) return;
        setIsMakingAllPrivate(true);
        try {
            const res = await fetch(`${API}/api/files/makeAllPrivate`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                setStatus({ message: "All files have been set to private.", type: 'success' });
                fetchPublicFiles();
                setTimeout(() => setStatus({ message: '', type: '' }), 3000);
            }
        } catch (err) {} finally {
            setIsMakingAllPrivate(false);
        }
    };

    const handleDeleteHistory = async () => {
        if (!window.confirm(`Are you sure you want to delete ${historyTimeframe === 'all' ? 'all' : `the ${historyTimeframe}'s`} history?`)) return;
        setIsDeletingHistory(true);
        try {
            const res = await fetch(`${API}/api/history?timeframe=${historyTimeframe}`, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                setStatus({ message: `History cleared successfully!`, type: 'success' });
                fetchAllHistory();
                setTimeout(() => setStatus({ message: '', type: '' }), 3000);
            } else {
                setStatus({ message: "Failed to delete history", type: 'error' });
                setTimeout(() => setStatus({ message: '', type: '' }), 3000);
            }
        } catch (err) {
            setStatus({ message: "Error deleting history", type: 'error' });
            setTimeout(() => setStatus({ message: '', type: '' }), 3000);
        } finally {
            setIsDeletingHistory(false);
        }
    };

    return (
        <div className="account-page">
            <nav className="account-navbar">
                <button className="back-btn" onClick={() => navigate('/home')}>
                    <FaArrowLeft /> Back to My Drive
                </button>
                {status.message && (
                    <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: status.type === 'success' ? 'var(--accent-success)' : 'var(--accent-error)', color: 'white', position: 'absolute', right: '2rem' }}>
                        {status.message}
                    </div>
                )}
            </nav>

            <div className="account-container">
                <h1 style={{ marginBottom: '2rem', color: 'var(--text-main)' }}>Security & Logging</h1>

                <div className="account-card security-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 className="card-title" style={{ margin: 0 }}><FaGlobe className="icon-primary" style={{color: 'var(--color-primary)'}}/> Shared Files</h2>
                        {publicFiles.length > 0 && (
                            <button 
                                className="btn btn-primary" 
                                style={{ background: 'var(--accent-error)', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px' }}
                                onClick={handleMakeAllPrivate}
                                disabled={isMakingAllPrivate}
                            >
                                <FaLock /> Make All Private
                            </button>
                        )}
                    </div>

                    <div className="history-list" style={{ maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.05)', borderRadius: '8px', padding: '1rem' }}>
                        {publicFiles.length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>No publicly shared files found.</p>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                        <th style={{ padding: '0.5rem' }}>Filename</th>
                                        <th style={{ padding: '0.5rem' }}>Access Count</th>
                                        <th style={{ padding: '0.5rem' }}>Expires At</th>
                                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {publicFiles.map((file, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '0.5rem', fontWeight: '500' }}>{file.filename}</td>
                                            <td style={{ padding: '0.5rem' }}>{file.metadata?.accessCount || 0}</td>
                                            <td style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>
                                                {file.metadata?.publicExpiresAt ? new Date(file.metadata.publicExpiresAt).toLocaleString() : 'Permanent'}
                                            </td>
                                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                                <button 
                                                    className="btn btn-ghost" 
                                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', color: 'var(--accent-error)' }}
                                                    onClick={() => handleMakePrivate(file._id)}
                                                >
                                                    Make Private
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="account-card history-card" style={{ marginTop: '2rem' }}>
                    <h2 className="card-title"><FaHistory className="icon-primary" style={{color: 'var(--color-primary)'}}/> Activity History</h2>
                    
                    <div className="history-controls" style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
                        <select 
                            className="form-control" 
                            value={historyTimeframe} 
                            onChange={(e) => setHistoryTimeframe(e.target.value)}
                            style={{ width: 'auto', padding: '0.4rem 0.8rem', borderRadius: '8px' }}
                        >
                            <option value="today">Today</option>
                            <option value="week">This Week</option>
                            <option value="month">This Month</option>
                            <option value="year">This Year</option>
                            <option value="all">All Time</option>
                        </select>
                        <button 
                            className="btn btn-primary" 
                            style={{ background: 'var(--accent-error)', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px' }}
                            onClick={handleDeleteHistory}
                            disabled={isDeletingHistory}
                        >
                            <FaTrash /> Delete By Timeframe
                        </button>
                    </div>

                    <div className="history-list" style={{ maxHeight: '300px', overflowY: 'auto', background: 'rgba(0,0,0,0.05)', borderRadius: '8px', padding: '1rem' }}>
                        {allHistory.length === 0 ? (
                            <p style={{ color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>No activity logged.</p>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                                        <th style={{ padding: '0.5rem' }}>Action</th>
                                        <th style={{ padding: '0.5rem' }}>File</th>
                                        <th style={{ padding: '0.5rem' }}>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allHistory.map((item, idx) => (
                                        <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '0.5rem', textTransform: 'capitalize' }}>{item.action}</td>
                                            <td style={{ padding: '0.5rem', fontWeight: '500' }}>{item.filename}</td>
                                            <td style={{ padding: '0.5rem', color: 'var(--text-muted)' }}>{new Date(item.timestamp).toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}

export default Security;
