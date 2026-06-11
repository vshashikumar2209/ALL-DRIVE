import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaArrowLeft, FaShieldAlt, FaMoon, FaDatabase } from 'react-icons/fa';
import './Account.css';

function Account() {
    const navigate = useNavigate();
    const user = JSON.parse(localStorage.getItem('user')) || { name: 'Guest', email: '' };
    const token = localStorage.getItem('token');
    
    const [storageStats, setStorageStats] = useState({ usedBytes: 0, totalFiles: 0, maxBytes: 15 * 1024 * 1024 * 1024 });
    const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordData, setPasswordData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });
    const [status, setStatus] = useState({ message: '', type: '' });
    const [isUpdating, setIsUpdating] = useState(false);
    const API = import.meta.env.VITE_API_BASE_URL;



    useEffect(() => {
        const fetchStorage = async () => {
            if (!token) return;
            try {
                const res = await fetch(`${API}/api/user/storage`, {
                    headers: { 'Authorization': 'Bearer ' + token },
                    credentials: 'include'
                });
                if (res.ok) {
                    const data = await res.json();
                    setStorageStats(data);
                }
            } catch (err) { }
        };
        fetchStorage();
    }, [token]);

    useEffect(() => {
        if (isDarkMode) {
            document.body.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [isDarkMode]);

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const usagePercentage = Math.min(100, (storageStats.usedBytes / storageStats.maxBytes) * 100);
    
    const barColorClass = usagePercentage > 90 ? 'danger' : usagePercentage > 75 ? 'warning' : '';

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordData.newPassword !== passwordData.confirmPassword) {
            setStatus({ message: "New passwords do not match!", type: 'error' });
            return;
        }

        setIsUpdating(true);
        setStatus({ message: 'Updating password and re-encrypting files...', type: 'success' });

        try {
            const res = await fetch(`${API}/api/user/change-password`, {
                method: 'POST',
                headers: { 
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    oldPassword: passwordData.oldPassword,
                    newPassword: passwordData.newPassword
                }),
                credentials: 'include'
            });

            const data = await res.json();
            if (res.ok) {
                setStatus({ message: 'Password changed successfully!', type: 'success' });
                setTimeout(() => {
                    setShowPasswordModal(false);
                    setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
                    setStatus({ message: '', type: '' });
                }, 2000);
            } else {
                setStatus({ message: data.message || 'Failed to change password', type: 'error' });
            }
        } catch (err) {
            setStatus({ message: 'An error occurred. Please try again.', type: 'error' });
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="account-page">
            <nav className="account-navbar">
                <button className="back-btn" onClick={() => navigate('/home')}>
                    <FaArrowLeft /> Back to My Drive
                </button>
                {status.message && !showPasswordModal && (
                    <div style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: status.type === 'success' ? 'var(--accent-success)' : 'var(--accent-error)', color: 'white', position: 'absolute', right: '2rem' }}>
                        {status.message}
                    </div>
                )}
            </nav>

            <div className="account-container">
                <div className="account-card profile-card">
                    <div className="profile-header">
                        <div className="avatar-large">
                            {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="profile-info">
                            <h1>{user.name}</h1>
                            <p>{user.email}</p>
                        </div>
                    </div>
                </div>

                <div className="account-card storage-card">
                    <h2 className="card-title"><FaDatabase className="icon-primary" style={{color: 'var(--primary-color)'}}/> Storage Overview</h2>
                    <div className="storage-stats">
                        <span>{formatBytes(storageStats.usedBytes)} used</span>
                        <span>{formatBytes(storageStats.maxBytes)} total</span>
                    </div>
                    <div className="storage-stats" style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem'}}>
                        <span>{storageStats.totalFiles} Files</span>
                        <span>{((storageStats.usedBytes / storageStats.maxBytes) * 100).toFixed(2)}% Used</span>
                    </div>
                    <div className="storage-bar-bg">
                        <div className={`storage-bar-fill ${barColorClass}`} style={{ width: `${Math.max(usagePercentage, 1)}%` }}></div>
                    </div>
                    <p style={{color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '1rem'}}>
                        You currently have {storageStats.totalFiles} deeply secured files stored on the GridFS network.
                    </p>
                </div>

                <div className="account-card settings-card">
                    <h2 className="card-title">Preferences & Security</h2>
                    <div className="settings-list">
                        
                        <div className="setting-item">
                            <div className="setting-info">
                                <FaMoon className="setting-icon"/>
                                <div className="setting-text">
                                    <h3>Dark Mode</h3>
                                    <p>Toggle sleek, low-light viewing.</p>
                                </div>
                            </div>
                            <label className="switch">
                                <input type="checkbox" checked={isDarkMode} onChange={(e) => setIsDarkMode(e.target.checked)} />
                                <span className="slider"></span>
                            </label>
                        </div>
                        
                        <div className="setting-item">
                            <div className="setting-info">
                                <FaShieldAlt className="setting-icon"/>
                                <div className="setting-text">
                                    <h3>Change Password</h3>
                                    <p>Update your master security key.</p>
                                </div>
                            </div>
                            <button className="btn btn-primary" style={{padding: '0.5rem 1rem', borderRadius: '8px'}} onClick={() => setShowPasswordModal(true)}>Update</button>
                        </div>

                    </div>
                </div>
            </div>

            {showPasswordModal && (
                <div className="modal-overlay">
                    <div className="modal-box">
                        <h2 className="modal-title">Change Password</h2>
                        <p className="modal-subtitle">Your files will be re-encrypted with your new key.</p>
                        
                        {status.message && (
                            <div className={`status-message status-${status.type}`}>
                                {status.message}
                            </div>
                        )}

                        <form onSubmit={handlePasswordChange}>
                            <div className="form-group">
                                <label>Current Password</label>
                                <input 
                                    type="password" 
                                    className="form-control" 
                                    required 
                                    value={passwordData.oldPassword}
                                    onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})}
                                />
                            </div>
                            <div className="form-group">
                                <label>New Password</label>
                                <input 
                                    type="password" 
                                    className="form-control" 
                                    required 
                                    minLength="6"
                                    value={passwordData.newPassword}
                                    onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                                />
                            </div>
                            <div className="form-group">
                                <label>Confirm New Password</label>
                                <input 
                                    type="password" 
                                    className="form-control" 
                                    required 
                                    value={passwordData.confirmPassword}
                                    onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                                />
                            </div>

                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" onClick={() => setShowPasswordModal(false)} disabled={isUpdating}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={isUpdating}>
                                    {isUpdating ? 'Updating...' : 'Update Password'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Account;
