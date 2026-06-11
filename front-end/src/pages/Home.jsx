import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FaCloudUploadAlt, FaFileAlt, FaSignOutAlt, FaSearch, FaEllipsisV, FaFolder, FaFilePdf, FaFileWord, FaFileExcel, FaFilePowerpoint, FaFileImage, FaFileAudio, FaFileVideo, FaFileCode, FaFile, FaBars, FaBell, FaHistory, FaUserCircle, FaMoon, FaSun, FaCog, FaShieldAlt, FaChartPie, FaPlus, FaClock, FaStar, FaRegStar, FaTrash } from 'react-icons/fa';
import './Home.css';
import { useRef } from 'react';

const Home = () => {
    const API = import.meta.env.VITE_API_BASE_URL;
    const [files, setFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState('');
    const token = localStorage.getItem('token');
    
    // Auth & Layout States
    const [user, setUser] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('user')) || { username: 'User', email: 'user@alldrive.com' };
        } catch {
            return { username: 'User', email: 'user@alldrive.com' };
        }
    });
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [historyData, setHistoryData] = useState([]);
    const [activeNav, setActiveNav] = useState('my-files');
    
    const [showModal, setShowModal] = useState(false);
    const [folderName, setFolderName] = useState('');
    const [folders, setFolders] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeMenu, setActiveMenu] = useState(null);
    const [isDarkMode, setIsDarkMode] = useState(localStorage.getItem('theme') === 'dark');
    const location = useLocation();

    const [storageStats, setStorageStats] = useState({ usedBytes: 0, totalFiles: 0, maxBytes: 15 * 1024 * 1024 * 1024 });

    const fileInputRef = useRef(null);
    const navigate = useNavigate();
    const [previewUrls, setPreviewUrls] = useState({});
    const observerRef = useRef(null);//only loads when files in viewport
    const fileRefs = useRef({}); //Intersection observer for infinite scroll
    const fetchingRefs = useRef(new Set()); // Track currently fetching files to prevent duplicates
    const abortControllers = useRef({}); // Track abort controllers for cancelling fetches
    const [showDurationModal, setShowDurationModal] = useState(false);
    const [selectedFileForPublic, setSelectedFileForPublic] = useState(null);
    const [isPermanent, setIsPermanent] = useState(false);
    const [durationDays, setDurationDays] = useState(1);
    const [durationHours, setDurationHours] = useState(0);
    const [durationMinutes, setDurationMinutes] = useState(0);

    const [showConflictModal, setShowConflictModal] = useState(false);
    const [conflictFile, setConflictFile] = useState(null);
    const [conflictFormData, setConflictFormData] = useState(null);
    
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [fileToDelete, setFileToDelete] = useState(null);
    const [selectedVersions, setSelectedVersions] = useState({});

    const getActiveFile = (fileGroup) => {
        if (!fileGroup.versions || fileGroup.versions.length <= 1) return fileGroup;
        const groupId = fileGroup.metadata?.fileGroupId || fileGroup._id;
        const selectedId = selectedVersions[groupId] || fileGroup._id;
        return fileGroup.versions.find(v => v._id === selectedId) || fileGroup;
    };



    // Derive currentPath from URL query params
    const getPathFromUrl = () => {
        const params = new URLSearchParams(location.search);
        return params.get('path') || '';
    };

    const currentPath = getPathFromUrl();

    useEffect(() => {
        if (isDarkMode) {
            document.body.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    }, [isDarkMode]);

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    const fetchStorageStats = async () => {
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
        } catch (err) {
            console.error("Error fetching storage stats:", err);
        }
    };

    useEffect(() => {
        fetchStorageStats();
        // Refresh when profile is opened
        if (isProfileOpen) fetchStorageStats();
    }, [token, isProfileOpen, files.length]);

    const fetchHistory = async () => {
        if(!token) return;
        try {
            const res = await fetch(`${API}/api/history?timeframe=today`, {
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                const data = await res.json();
                setHistoryData(data);
            }
        } catch(err) {
            console.error("Error fetching history");
        }
    };

    const clearTodayHistory = async (e) => {
        e.stopPropagation();
        if(!window.confirm("Are you sure you want to clear today's history?")) return;
        try {
            const res = await fetch(`${API}/api/history?timeframe=today`, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include'
            });
            if (res.ok) {
                setHistoryData([]);
            }
        } catch(err) {
            console.error("Error clearing history");
        }
    };

    useEffect(() => {
        if (!token) {
            navigate(`/login`);
            return;
        }
        fetchFiles();
        fetchFolders();
    }, [token, navigate, currentPath]); // Depend on currentPath (which comes from URL)



    const fetchFiles = async () => {
        try {
            const res = await fetch(`${API}/api/files?path=${encodeURIComponent(currentPath || '')}`, {
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include',
            });

            if (res.status === 401) {
                handleLogout();
                return;
            }
            const data = await res.json();
            setFiles(data);
        } catch (err) {
            console.error('Error fetching files:', err);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    const handleUpload = async (e, retryAction = null, existingFormData = null) => {
        if (e) e.preventDefault();
        const formData = existingFormData || new FormData(e.target);
        if (!existingFormData) {
            formData.set('path', currentPath || '');
        }
        if (retryAction) {
            formData.set('conflictAction', retryAction);
        }

        setUploading(true);
        setStatus('');
        let isConflict = false;

        try {
            const res = await fetch(`${API}/api/upload`, {
                method: 'POST',
                body: formData,
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include',
            });

            if (res.status === 409) {
                isConflict = true;
                const data = await res.json();
                setConflictFile(data.filename);
                setConflictFormData(formData);
                setShowConflictModal(true);
                setUploading(false);
                return;
            }

            if (res.ok) {
                setStatus('Files uploaded successfully!');
                if (e) e.target.reset();
                if (fileInputRef.current) fileInputRef.current.value = '';
                setShowConflictModal(false);
                setConflictFormData(null);
                setConflictFile(null);
                fetchFiles();
                setTimeout(() => { setStatus(''); }, 2000);
            } else {
                setStatus('Upload failed.');
                setTimeout(() => { setStatus(''); }, 2000);
            }
        } catch (err) {
            setStatus('Error uploading files.');
            setTimeout(() => { setStatus(''); }, 2000);
        } finally {
            if (!isConflict) setUploading(false);
        }
    };
    const handleDelete = async (fileId, mode = 'all', permanent = false) => {
        try {
            const res = await fetch(`${API}/api/files/${fileId}?deleteMode=${mode}&permanent=${permanent}`, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include',
            });
            if (res.ok) {
                setStatus(permanent ? 'File permanently deleted!' : 'File moved to trash.');
                fetchFiles();
                setShowDeleteModal(false);
                setFileToDelete(null);
                setTimeout(() => { setStatus(''); }, 2000);
            } else {
                setStatus('Failed to delete file.');
                setTimeout(() => { setStatus(''); }, 2000);
            }
        } catch (err) {
            setStatus('Error deleting file.');
            setTimeout(() => { setStatus(''); }, 2000);
        }
    };

    const handleDeleteClick = (fileGroup) => {
        const activeFile = getActiveFile(fileGroup);
        const isTrash = activeNav === 'trash';
        setFileToDelete(activeFile);
        
        if (fileGroup.versions && fileGroup.versions.length > 1) {
            setShowDeleteModal(true);
        } else {
            handleDelete(activeFile._id, 'all', isTrash);
        }
    };

    const handleRestore = async (fileGroup) => {
        const activeFile = getActiveFile(fileGroup);
        try {
            const res = await fetch(`${API}/api/files/restore/${activeFile._id}`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                credentials: 'include',
            });
            if (res.ok) {
                setStatus('File restored successfully!');
                fetchFiles();
                setTimeout(() => setStatus(''), 2000);
            } else {
                setStatus('Failed to restore file.');
                setTimeout(() => setStatus(''), 2000);
            }
        } catch(e) {
            setStatus('Error restoring file.');
            setTimeout(() => setStatus(''), 2000);
        }
    };

    const handleToggleStar = async (fileGroup) => {
        const activeFile = getActiveFile(fileGroup);
        const newStatus = !activeFile.metadata?.isStarred;
        try {
            const res = await fetch(`${API}/api/files/star/${activeFile._id}`, {
                method: 'POST',
                headers: { 
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ isStarred: newStatus }),
                credentials: 'include',
            });
            if (res.ok) {
                fetchFiles();
            } else {
                setStatus('Failed to update star status.');
                setTimeout(() => setStatus(''), 2000);
            }
        } catch(e) {
            setStatus('Error updating star status.');
            setTimeout(() => setStatus(''), 2000);
        }
    };

    const handleCreateFolder = async () => {

        await fetch(`${API}/api/folders`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: currentPath, folderName })
        });

        setShowModal(false);
        setFolderName('');
        fetchFolders(); // re-fetch folder list
    };
    const fetchFolders = async () => {
        try {
            console.log(currentPath);
            const res = await fetch(`${API}/api/folders?path=${encodeURIComponent(currentPath || '')}`,
                {
                    credentials: 'include',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    }
                }
            )
            if (res.ok) {
                const data = await res.json();
                setFolders(data);
                console.log(data);

            }
        }
        catch (err) {
            console.log(err);
        }
    };

    const handelDeleteFolder = async (folderId) => {
        try {
            const res = await fetch(`${API}/api/folders/${folderId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Authorization': 'Bearer ' + token }
            })
            if (res.ok) {
                setStatus('Folder deleted Successfully!');
                fetchFolders();
                setTimeout(() => { setStatus(''); }, 2000);
            }
        }
        catch (err) {
            console.log(err);
        }
    };

    const changeToNewFolder = (folder) => {
        // Just navigate basically updates the URL, and useEffect picks it up
        const newPath = currentPath + folder + '/';
        navigate(`/home?path=${encodeURIComponent(newPath)}`);
    };

    const handleGoBack = () => {
        if (!currentPath) return;
        const parts = currentPath.split('/').filter(p => p);
        parts.pop();
        const newPath = parts.length > 0 ? parts.join('/') + '/' : '';
        navigate(newPath ? `/home?path=${encodeURIComponent(newPath)}` : '/home');
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const droppedFiles = e.dataTransfer.files;

        if (fileInputRef.current) {
            fileInputRef.current.files = droppedFiles;
        }
    };
    const handleOpenFile = async (file) => {
        try {
            const fileId = file._id;
            const cacheName = 'file-cache';
            const requestUrl = `${API}/api/files/content/${fileId}`;
            // console.log(fileId + "before opening ifile in home.jsx")
            // Try to open from cache first
            const cache = await window.caches.open(cacheName);
            const cachedResponse = await cache.match(requestUrl);

            if (cachedResponse) {
                // console.log("Opening from cache:", file.filename);
                const blob = await cachedResponse.blob(); // Blob - Binary Large Object(converting response to blob)
                const url = window.URL.createObjectURL(blob);
                window.open(url, '_blank');
                return;
                // Blob = water in a bottle
                // URL = label on the bottle
                // Browser opens the bottle using the label
            }

            // If not in cache, download it
            setStatus(`Opening ${file.filename}...`);
            // console.log("Downloading file:", file.filename);

            const response = await fetch(requestUrl, {
                method: 'GET',
                credentials: 'include',
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (!response.ok) {
                throw new Error('Download failed');
            }

            // Clone response to put in cache (response body can only be consumed once)
            const responseClone = response.clone();
            await cache.put(requestUrl, responseClone);

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);

            setTimeout(() => { setStatus(''); }, 2000);
            window.open(url, '_blank');

        } catch (err) {
            console.error("Error opening file:", err);
            setStatus('Error opening file.');
            setTimeout(() => { setStatus(''); }, 2000);
        }
    };

    const handleDownload = async (file) => {
        try {
            const fileId = file._id;
            const requestUrl = `${API}/api/files/content/${file._id}`; // use specific download route if available, or content route
            // In your backend, you might have a specific download route that sets Content-Disposition: attachment

            setStatus(`Downloading ${file.filename}...`);

            const response = await fetch(requestUrl, {
                method: 'GET',
                credentials: 'include',
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (!response.ok) {
                throw new Error('Download failed');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            setStatus('Download complete!');
            setTimeout(() => { setStatus(''); }, 2000);

        } catch (err) {
            console.error("Error downloading file:", err);
            setStatus('Error downloading file.');
            setTimeout(() => { setStatus(''); }, 2000);
        }
    };
    useEffect(() => {
        return () => {  // cleanup after component unmounts(component is removed from the DOM)
            Object.values(previewUrls).forEach(URL.revokeObjectURL); // revokeObjectURL() releases the memory occupied by the object URL
        };
    }, []);

    useEffect(() => {
        observerRef.current = new IntersectionObserver(async (entries) => {
            for (const entrie of entries) {
                const fileId = entrie.target.dataset.id;
                if (!fileId) continue;

                if (!entrie.isIntersecting) {
                    if (abortControllers.current[fileId]) {
                        abortControllers.current[fileId].abort();
                        delete abortControllers.current[fileId];
                        fetchingRefs.current.delete(fileId);
                    }
                    continue;
                }

                if (fetchingRefs.current.has(fileId)) continue;
                fetchingRefs.current.add(fileId);
                
                const controller = new AbortController();
                abortControllers.current[fileId] = controller;

                try {
                    const previewUrl = await previewFile(fileId, controller.signal);
                    setPreviewUrls((prev) => ({
                        ...prev,
                        [fileId]: previewUrl
                    }));
                    if (!abortControllers.current[fileId]?.signal.aborted) {
                        observerRef.current.unobserve(entrie.target);
                    }
                }
                catch (err) {
                    if (err.name === 'AbortError') {
                        // was gracefully aborted, will retry when in view
                    } else {
                        console.error('Preview fetch error:', err);
                        setPreviewUrls((prev) => ({
                            ...prev,
                            [fileId]: 'error'
                        }));
                        if (!abortControllers.current[fileId]?.signal.aborted) {
                            observerRef.current.unobserve(entrie.target);
                        }
                    }
                } finally {
                    delete abortControllers.current[fileId];
                }
            }
        }, {
            root: null,
            rootMargin: '100px',
            threshold: 0.1
        });

        // Re-observe all existing elements when the observer is recreated (which is only once now)
        Object.values(fileRefs.current).forEach(el => {
            if (el) observerRef.current.observe(el);
        });
        return () => observerRef.current?.disconnect();
    }, []); // Removed previewUrls dependency to prevent observer recreation

    async function previewFile(fileId, signal) {
        const res = await fetch(`${API}/api/files/previewFile/${fileId}`, {
            credentials: 'include',
            headers: { Authorization: 'Bearer ' + token },
            signal
        });

        if (!res.ok) {
            throw new Error('Preview fetch failed');
        }

        const blob = await res.blob();
        return URL.createObjectURL(blob);
    }

    const toggleMenu = (fileId, e) => {
        e.stopPropagation();
        setActiveMenu(activeMenu === fileId ? null : fileId);
    };

    const getFileIcon = (filename) => {
        const ext = filename?.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return <FaFileImage />;
        if (['pdf'].includes(ext)) return <FaFilePdf />;
        if (['doc', 'docx'].includes(ext)) return <FaFileWord />;
        if (['xls', 'xlsx'].includes(ext)) return <FaFileExcel />;
        if (['ppt', 'pptx'].includes(ext)) return <FaFilePowerpoint />;
        if (['mp3', 'wav', 'ogg'].includes(ext)) return <FaFileAudio />;
        if (['mp4', 'avi', 'mov', 'mkv'].includes(ext)) return <FaFileVideo />;
        if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'py', 'java', 'c', 'cpp'].includes(ext)) return <FaFileCode />;
        return <FaFile />;
    };

    const isImageFile = (filename) => {
        const ext = filename?.split('.').pop().toLowerCase();
        return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext);
    };
    const initiateMakePublic = (file) => {
        setSelectedFileForPublic(file);
        setIsPermanent(false);
        setDurationDays(1);
        setDurationHours(0);
        setDurationMinutes(0);
        setShowDurationModal(true);
    };

    const handleMakePublic = async () => {
        if (!selectedFileForPublic) return;

        let finalDuration;
        if (isPermanent) {
            finalDuration = 'permanent';
        } else {
            const d = parseInt(durationDays) || 0;
            const h = parseInt(durationHours) || 0;
            const m = parseInt(durationMinutes) || 0;

            if (d === 0 && h === 0 && m === 0) {
                setStatus('Please set a duration greater than 0');
                setTimeout(() => setStatus(''), 3000);
                return;
            }

            finalDuration = `${d}-${h}-${m}`;
        }

        try {
            const res = await fetch(`${API}/api/files/makePublic/${selectedFileForPublic._id}`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ duration: finalDuration })
            });

            if (!res.ok) {
                throw new Error('Failed to make file public');
            }

            const data = await res.json();
            console.log(data);

            setShowDurationModal(false);
            setSelectedFileForPublic(null);

            // Refresh to update UI state
            fetchFiles();
        } catch (err) {
            console.error("Error making file public:", err);
            setStatus('Error making file public');
            setTimeout(() => setStatus(''), 3000);
        }
    }

    const handleMakePrivate = async (file) => {
        try {
            const res = await fetch(`${API}/api/files/makePrivate/${file._id}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Failed to make file private');
            }

            setStatus('File made private successfully');
            setTimeout(() => setStatus(''), 2000);
            fetchFiles(); // Refresh list to update UI
        } catch (err) {
            console.error("Error making private:", err);
            setStatus('Error: ' + err.message);
            setTimeout(() => setStatus(''), 3000);
        }
    }

    const handleCopyLink = (file) => {
        if (!file.metadata?.filePublicId) return;
        const link = `${API}/api/files/public/${file.metadata.filePublicId}`;
        navigator.clipboard.writeText(link).then(() => {
            setStatus('Link copied to clipboard!');
            setTimeout(() => setStatus(''), 2000);
        }, (err) => {
            console.error('Could not copy text: ', err);
            setStatus('Failed to copy link');
            setTimeout(() => setStatus(''), 2000);
        });
    }

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = () => {
            setActiveMenu(null);
            setIsProfileOpen(false);
            setIsHistoryOpen(false);
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);
    return (
        <div className={`app-wrapper ${isDarkMode ? 'dark-theme' : ''}`}>
            <nav className="navbar">
                <div className="navbar-left">
                    <button className="icon-btn mobile-menu-btn" onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(!isMobileMenuOpen); setIsSidebarCollapsed(!isSidebarCollapsed); }}>
                        <FaBars />
                    </button>
                    <div className="navbar-brand" onClick={() => { setActiveNav('my-files'); navigate('/home'); }}>
                        <img src="/icon.JPG" alt="AllDrive Logo" className="logo-img" />
                    </div>
                </div>

                <div className="navbar-center">
                    <div className="search-wrapper">
                        <FaSearch className="search-icon" />
                        <input 
                            type="text" 
                            className="nav-search-input" 
                            placeholder="Search in Drive..." 
                            value={searchQuery} 
                            onChange={(e) => setSearchQuery(e.target.value)} 
                        />
                    </div>
                </div>

                <div className="navbar-right">
                    <button 
                        className="btn btn-primary btn-upload-nav"
                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    >
                        <FaPlus /> <span className="upload-text">New</span>
                    </button>
                    <div className="history-menu-container" style={{ position: 'relative' }}>
                        <button className="icon-btn history-btn" onClick={(e) => { e.stopPropagation(); setIsHistoryOpen(!isHistoryOpen); if(!isHistoryOpen) fetchHistory(); }}>
                            <FaHistory />
                        </button>
                        {isHistoryOpen && (
                            <div className="profile-dropdown" style={{ width: '320px', maxHeight: '400px', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
                                <div className="profile-header" style={{ paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span className="profile-name" style={{ margin: 0 }}>Today's Activity</span>
                                    {historyData.length > 0 && (
                                        <button className="btn btn-ghost" style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: 'var(--accent-error)' }} onClick={clearTodayHistory}>Clear</button>
                                    )}
                                </div>
                                <div className="dropdown-divider"></div>
                                {historyData.length === 0 ? (
                                    <div className="menu-item" style={{ justifyContent: 'center', opacity: 0.7 }}>No recent activity</div>
                                ) : (
                                    historyData.map((item, idx) => (
                                        <div key={idx} className="menu-item" style={{ fontSize: '0.85rem', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem', padding: '0.5rem 1.5rem', cursor: 'default' }}>
                                            <div><strong>{item.filename}</strong> was {item.action} at</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-primary)' }}>{new Date(item.timestamp).toLocaleString()}</div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                    
                    <div className="profile-menu-container">
                        <button className="profile-btn" onClick={(e) => { e.stopPropagation(); setIsProfileOpen(!isProfileOpen); }}>
                            <FaUserCircle className="avatar-icon" />
                        </button>

                        {isProfileOpen && (
                            <div className="profile-dropdown" onClick={(e) => e.stopPropagation()}>
                                <div className="profile-header">
                                    <span className="profile-name">{user.username || 'User'}</span>
                                    <span className="profile-email">{user.email || 'user@example.com'}</span>
                                </div>
                                <div className="dropdown-divider"></div>
                                <div className="storage-section">
                                    <div className="storage-header">
                                        <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}><FaChartPie className="menu-icon"/> <span>Storage Usage</span></div>
                                    </div>
                                    <div className="progress-bar-container">
                                        <div className="progress-bar-fill" style={{width: `${Math.min((storageStats.usedBytes / storageStats.maxBytes) * 100, 100)}%`}}></div>
                                    </div>
                                    <div className="storage-text">{formatBytes(storageStats.usedBytes)} / {formatBytes(storageStats.maxBytes)} used</div>
                                </div>
                                <div className="dropdown-divider"></div>
                                <div className="menu-item" onClick={() => { setIsProfileOpen(false); navigate('/account'); }}>
                                    <FaCog className="menu-icon"/> Account
                                </div>
                                <div className="menu-item" onClick={() => { setIsProfileOpen(false); navigate('/security'); }}>
                                    <FaShieldAlt className="menu-icon"/> Security
                                </div>
                                <div className="menu-item" onClick={() => { setIsDarkMode(!isDarkMode); setIsProfileOpen(false); }}>
                                    {isDarkMode ? <FaSun className="menu-icon"/> : <FaMoon className="menu-icon"/>} {isDarkMode ? 'Light Mode' : 'Dark Mode'}
                                </div>
                                <div className="dropdown-divider"></div>
                                <div className="menu-item delete-item" onClick={handleLogout}>
                                    <FaSignOutAlt className="menu-icon"/> Logout
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                {status && (
                    <div className={`status-toast ${status.toLowerCase().includes('error') ? 'error' : 'success'}`}>
                        {status}
                    </div>
                )}
            </nav>

            <div className={`main-layout ${isMobileMenuOpen ? 'mobile-open' : ''} ${isSidebarCollapsed ? 'sidebar-hidden' : ''}`}>
                <aside className="sidebar">
                    {activeNav === 'my-files' && (
                        <button className="btn btn-primary btn-upload-sidebar" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                            <FaPlus /> <span style={{marginLeft: '0.5rem'}}>New</span>
                        </button>
                    )}
                    <nav className="nav-links" style={{marginTop: activeNav !== 'my-files' ? '20px' : '0'}}>
                        <div className={`nav-link ${activeNav === 'my-files' ? 'active' : ''}`} onClick={() => { setActiveNav('my-files'); navigate('/home'); }}>
                            <FaFolder className="nav-icon"/> My Files
                        </div>
                        <div className={`nav-link ${activeNav === 'recent' ? 'active' : ''}`} onClick={() => { setActiveNav('recent'); navigate('/home?path=/recent'); }}>
                            <FaClock className="nav-icon"/> Recent
                        </div>
                        <div className={`nav-link ${activeNav === 'starred' ? 'active' : ''}`} onClick={() => { setActiveNav('starred'); navigate('/home?path=/starred'); }}>
                            <FaStar className="nav-icon"/> Starred
                        </div>
                        <div className={`nav-link ${activeNav === 'trash' ? 'active' : ''}`} onClick={() => { setActiveNav('trash'); navigate('/home?path=/trash'); }}>
                            <FaTrash className="nav-icon"/> Trash
                        </div>
                    </nav>
                </aside>

                <div className="content-area">
                    <div className="container">
                        <div className="grid-container">

                    {/* Upload Section */}
                    {activeNav === 'my-files' && (
                    <div className="card glass">
                        <h2 className="section-title">
                            <FaCloudUploadAlt className="icon-primary" /> Upload Files
                        </h2>
                        <form onSubmit={handleUpload}>
                            <div className="dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e)}>
                                <input type="file" name="files" multiple className="file-input" ref={fileInputRef} />
                                <p className="dropzone-text">
                                    Drag and drop or review files
                                </p>
                            </div>

                            <button type="submit" disabled={uploading} className="btn btn-primary btn-full-width">
                                {uploading ? 'Uploading...' : 'Upload Now'}
                            </button>
                        </form>
                    </div>
                    )}
                    {/* Folder Section */}

                    {activeNav === 'my-files' && (
                    <div className='card glass folder-section'>
                        <div className='folder-section'>
                            <h2 className="files-title">Your Folders</h2>
                            <div className="folder-actions">
                                {currentPath && (
                                    <button className="btn btn-primary mr-2" onClick={handleGoBack}>
                                        Go Back
                                    </button>
                                )}
                                <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New Folder</button>
                            </div>
                        </div>
                        <ul className="file-list">
                            {folders.filter(folder => folder.filename.toLowerCase().includes(searchQuery.toLowerCase())).map((folder) => (
                                <li key={folder._id} className="folder-item" onDoubleClick={() => changeToNewFolder(folder.filename)}>
                                    <FaFolder className="folder-icon-large" />
                                    <span className="file-name">{folder.filename}</span>

                                    <div className="menu-container">
                                        <button className="btn-icon three-dots-btn" onClick={(e) => toggleMenu(folder._id, e)}>
                                            <FaEllipsisV />
                                        </button>

                                        {activeMenu === folder._id && (
                                            <div className="menu-dropdown">
                                                <div className="menu-item" onClick={(e) => {
                                                    e.stopPropagation();
                                                    changeToNewFolder(folder.filename);
                                                    setActiveMenu(null);
                                                }}>Open</div>
                                                <div className="menu-item delete-item" onClick={(e) => {
                                                    e.stopPropagation();
                                                    handelDeleteFolder(folder._id);
                                                    setActiveMenu(null);
                                                }}>Delete</div>
                                            </div>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                    )}
                    {showModal && (
                        <div className="modal-overlay">
                            <div className="modal-box">
                                <h3>Create New Folder</h3>

                                <input type="text" placeholder="Folder name" value={folderName} onChange={(e) => setFolderName(e.target.value)} autoFocus />

                                <div className="modal-actions">
                                    <button className="btn btn-secondary" onClick={() => {
                                        setShowModal(false);
                                        setFolderName('');
                                    }}>Cancel</button>

                                    <button className="btn btn-primary" onClick={handleCreateFolder} disabled={!folderName.trim()}>Create</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showDurationModal && (
                        <div className="modal-overlay">
                            <div className="modal-box">
                                <h3>Set Public Link Duration</h3>
                                <p className="modal-description">Choose how long this link should remain active.</p>

                                <div className="duration-inputs-container">
                                    <label className="checkbox-container mb-4">
                                        <input
                                            type="checkbox"
                                            checked={isPermanent}
                                            onChange={(e) => setIsPermanent(e.target.checked)}
                                        />
                                        <span className="checkmark"></span>
                                        <span className="checkbox-label">Permanent (No Expiration)</span>
                                    </label>

                                    {!isPermanent && (
                                        <div className="time-inputs">
                                            <div className="time-field">
                                                <label>Days</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    value={durationDays}
                                                    onChange={(e) => setDurationDays(e.target.value)}
                                                    className="input-field"
                                                />
                                            </div>
                                            <div className="time-field">
                                                <label>Hours</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="23"
                                                    value={durationHours}
                                                    onChange={(e) => {
                                                        let val = parseInt(e.target.value);
                                                        if (isNaN(val)) val = 0; // or allow empty string if desired, but 0 is safe
                                                        if (val < 0) val = 0;
                                                        if (val > 23) val = 23;
                                                        setDurationHours(val);
                                                    }}
                                                    className="input-field"
                                                />
                                            </div>
                                            <div className="time-field">
                                                <label>Minutes</label>
                                                <input
                                                    type="number"
                                                    min="0"
                                                    max="59"
                                                    value={durationMinutes}
                                                    onChange={(e) => {
                                                        let val = parseInt(e.target.value);
                                                        if (isNaN(val)) val = 0;
                                                        if (val < 0) val = 0;
                                                        if (val > 59) val = 59;
                                                        setDurationMinutes(val);
                                                    }}
                                                    className="input-field"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="modal-actions">
                                    <button className="btn btn-secondary" onClick={() => {
                                        setShowDurationModal(false);
                                        setSelectedFileForPublic(null);
                                    }}>Cancel</button>

                                    <button className="btn btn-primary" onClick={handleMakePublic}>Confirm</button>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Files Section */}
                    <div className="card glass files-section">
                        <div className="files-header">
                            <h2 className="files-title">Your Files</h2>
                        </div>

                        {files.filter(file => (typeof file === 'string' ? file : (file.filename || '')).toLowerCase().includes(searchQuery.toLowerCase())).length === 0 ? (
                            <div className="no-files">
                                <FaFileAlt className="no-files-icon" />
                                <p>No files found.</p>
                            </div>
                        ) : (
                            <ul className="file-list">
                                {files.filter(fileGroup => (typeof fileGroup === 'string' ? fileGroup : (fileGroup.filename || '')).toLowerCase().includes(searchQuery.toLowerCase())).map((fileGroup, index) => {
                                    const file = getActiveFile(fileGroup);
                                    const filename = typeof file === 'string' ? file : file.filename || 'Untitled';
                                    const fileId = fileGroup._id || index;
                                    const isImg = isImageFile(filename);
                                    const isPdf = filename?.toLowerCase().endsWith('.pdf');
                                    const activeFile = getActiveFile(fileGroup); // Ensure activeFile is defined for dropdown logic

                                    return (
                                        <li key={`${fileId}-${file._id}`} className="file-card" data-id={file._id}
                                            ref={el => {
                                                if (!el || !file?._id) return;
                                                fileRefs.current[file._id] = el;
                                                observerRef.current?.observe(el);
                                            }}
                                            onDoubleClick={() => handleOpenFile(file)}
                                        >

                                            <div className="file-header">
                                                <div className="file-icon-small">
                                                    {getFileIcon(filename)}
                                                </div>
                                                <div style={{display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0}}>
                                                    <span className="file-name" title={filename}>
                                                        {filename}
                                                    </span>
                                                    {fileGroup.versions && fileGroup.versions.length > 1 && (
                                                        <select 
                                                            className="version-select"
                                                            onClick={e => e.stopPropagation()}
                                                            value={file._id}
                                                            onChange={e => {
                                                                const val = e.target.value;
                                                                setSelectedVersions(prev => ({...prev, [fileGroup.metadata?.fileGroupId || fileGroup._id]: val}));
                                                            }}
                                                            style={{fontSize: '10px', marginTop: '2px', background: '#333', color: '#ccc', border: '1px solid #555', borderRadius: '4px', padding: '1px'}}
                                                        >
                                                            {fileGroup.versions.map(v => (
                                                                <option key={v._id} value={v._id}>
                                                                    Version {v.metadata?.version || 1}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </div>

                                                <div className="menu-container" style={{display: 'flex', alignItems: 'center'}}>
                                                    <button className="btn-icon star-btn" style={{padding: '0.3rem', fontSize: '1rem', color: activeFile.metadata?.isStarred ? '#f1c40f' : 'var(--text-muted)'}} onClick={(e) => { e.stopPropagation(); handleToggleStar(fileGroup); }}>
                                                        {activeFile.metadata?.isStarred ? <FaStar /> : <FaRegStar />}
                                                    </button>
                                                    <button className="btn-icon three-dots-btn" onClick={(e) => toggleMenu(fileId, e)}>
                                                        <FaEllipsisV />
                                                    </button>

                                                    {activeMenu === fileId && (
                                                        <div className="menu-dropdown">
                                                              {activeNav === 'trash' ? (
                                                                  <>
                                                                    <div className="menu-item" onClick={(e) => { e.stopPropagation(); handleRestore(fileGroup); setActiveMenu(null); }}>Restore</div>
                                                                    <div className="menu-item delete-item" onClick={(e) => { e.stopPropagation(); handleDeleteClick(fileGroup); setActiveMenu(null); }}>Delete Permanently</div>
                                                                  </>
                                                              ) : (
                                                                  <>
                                                                    <div className="menu-item" onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleOpenFile(file);
                                                                        setActiveMenu(null);
                                                                    }}>Open</div>
                                                                    {!activeFile.metadata?.isPublic ? (
                                                                        <div className="menu-item" onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            initiateMakePublic(file);
                                                                            setActiveMenu(null);
                                                                        }}>
                                                                            Make Public
                                                                        </div>
                                                                    ) : (
                                                                        <div className="menu-item" onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleMakePrivate(activeFile);
                                                                            setActiveMenu(null);
                                                                        }}>
                                                                            Make Private
                                                                        </div>
                                                                    )}
                                                                    {activeFile.metadata?.isPublic && (
                                                                        <div className="menu-item" onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleCopyLink(activeFile);
                                                                            setActiveMenu(null);
                                                                        }}>Copy Link</div>
                                                                    )}
                                                                    <div className="menu-item" onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDownload(activeFile);
                                                                        setActiveMenu(null);
                                                                    }}>Download</div>
                                                                    <div className="menu-item delete-item" onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleDeleteClick(fileGroup);
                                                                        setActiveMenu(null);
                                                                    }}>Delete</div>
                                                                  </>
                                                              )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="file-preview">
                                                {isImg ? (
                                                    previewUrls[file._id] ? (
                                                        previewUrls[file._id] === 'error' ? (
                                                            <div className="preview-icon"><FaFileImage style={{opacity: 0.5}} /></div>
                                                        ) : (
                                                            <img
                                                                src={previewUrls[file._id]}
                                                                alt={filename}
                                                                className="preview-image"
                                                                onError={() => setPreviewUrls(p => ({...p, [file._id]: 'error'}))}
                                                            />
                                                        )
                                                    ) : (
                                                        <div>Loading...</div>
                                                    )
                                                ) : isPdf ? (
                                                    previewUrls[file._id] ? (
                                                        previewUrls[file._id] === 'error' ? (
                                                            <div className="preview-icon"><FaFilePdf style={{opacity: 0.5}} /></div>
                                                        ) : (
                                                            <iframe
                                                                src={`${previewUrls[file._id]}#toolbar=0&navpanes=0&scrollbar=0`}
                                                                className="preview-iframe"
                                                                title={filename}
                                                                allow="autofocus"
                                                            />
                                                        )
                                                    ) : (
                                                        <div>Loading...</div>
                                                    )
                                                ) : (
                                                    <div className="preview-icon">{getFileIcon(filename)}</div>
                                                )}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
            </div>
            </div>

            {showConflictModal && (
                <div className="modal-overlay">
                    <div className="modal-box">
                        <h3>File Conflict</h3>
                        <p className="modal-description">A file named "{conflictFile}" already exists.</p>
                        <div className="modal-actions" style={{display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px'}}>
                            <button className="btn btn-primary" onClick={() => handleUpload(null, 'keep_both', conflictFormData)}>Keep Both (Rename new file)</button>
                            <button className="btn btn-primary" style={{backgroundColor: '#e74c3c'}} onClick={() => handleUpload(null, 'replace', conflictFormData)}>Replace Existing File</button>
                            <button className="btn btn-primary" style={{backgroundColor: '#2ecc71'}} onClick={() => handleUpload(null, 'update_version', conflictFormData)}>Update as New Version</button>
                            <button className="btn btn-secondary" onClick={() => { setShowConflictModal(false); setConflictFormData(null); }}>Cancel Upload</button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteModal && (
                <div className="modal-overlay">
                    <div className="modal-box">
                        <h3>Delete File</h3>
                        <p className="modal-description">This file has multiple versions. What would you like to do?</p>
                        <div className="modal-actions" style={{display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '20px'}}>
                            <button className="btn btn-primary" style={{backgroundColor: '#e74c3c'}} onClick={() => handleDelete(fileToDelete._id, 'all', activeNav === 'trash')}>
                                {activeNav === 'trash' ? 'Delete All Versions Permanently' : 'Move All Versions to Trash'}
                            </button>
                            <button className="btn btn-primary" onClick={() => handleDelete(fileToDelete._id, 'revert', activeNav === 'trash')}>
                                {activeNav === 'trash' ? 'Revert to Previous (Delete Current Permanently)' : 'Revert to Previous (Move Current to Trash)'}
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setShowDeleteModal(false); setFileToDelete(null); }}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;
