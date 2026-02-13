import React, { useState } from 'react';
import { Settings2, X, Key, Save, Globe } from 'lucide-react';
import { useInterview } from '../context/InterviewContext';
import { Button } from './Button';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { settings, updateSettings } = useInterview();
    const [googleKey, setGoogleKey] = useState(settings.googleApiKey || '');
    const [openRouterKey, setOpenRouterKey] = useState(settings.openRouterApiKey || '');
    const [provider, setProvider] = useState(settings.provider);

    if (!isOpen) return null;

    const handleSave = () => {
        updateSettings({
            googleApiKey: googleKey,
            openRouterApiKey: openRouterKey,
            provider: provider
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-[2px]">
            <div className="bg-white border-[4px] border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] w-full max-w-lg overflow-hidden flex flex-col">

                {/* Header */}
                <header className="p-6 border-b-[4px] border-black flex justify-between items-center bg-secondary">
                    <div className="flex items-center gap-3">
                        <Settings2 className="w-6 h-6 text-black" />
                        <h2 className="text-xl font-black text-black uppercase tracking-tighter">Session Settings</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 border-[3px] border-black bg-white hover:bg-tertiary flex items-center justify-center text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all"
                    >
                        <X className="w-5 h-5 stroke-[3px]" />
                    </button>
                </header>

                {/* Body */}
                <div className="p-8 space-y-8 bg-white">

                    {/* Provider Selection */}
                    <div className="space-y-3">
                        <label className="text-xs font-black text-black uppercase tracking-widest block">AI Provider</label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setProvider('google')}
                                className={`p-4 border-[3px] border-black text-left flex items-center gap-3 transition-all hidden ${provider === 'google'
                                    ? 'bg-main text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
                                    : 'bg-white hover:bg-slate-50'
                                    }`}
                            >
                                <div className={`w-4 h-4 rounded-full border-2 border-black ${provider === 'google' ? 'bg-black' : 'bg-transparent'}`} />
                                <span className="text-sm font-black uppercase">Google</span>
                            </button>

                            <button
                                onClick={() => setProvider('openrouter')}
                                className={`p-4 border-[3px] border-black text-left flex items-center gap-3 transition-all ${provider === 'openrouter'
                                    ? 'bg-quat shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]'
                                    : 'bg-white hover:bg-slate-50'
                                    }`}
                            >
                                <div className={`w-4 h-4 rounded-full border-2 border-black ${provider === 'openrouter' ? 'bg-black' : 'bg-transparent'}`} />
                                <span className="text-sm font-black uppercase">OpenRouter</span>
                            </button>
                        </div>
                    </div>

                    {/* API Keys */}
                    {provider === 'google' ? (
                        <div className="space-y-3">
                            <label className="text-xs font-black text-black uppercase tracking-widest block flex items-center gap-2">
                                <Key className="w-4 h-4" /> Google API Key
                            </label>
                            <input
                                type="password"
                                value={googleKey}
                                onChange={(e) => setGoogleKey(e.target.value)}
                                placeholder="AIza..."
                                className="w-full p-4 text-sm font-bold bg-white border-[3px] border-black outline-none focus:bg-secondary transition-colors placeholder:text-black/30 neo-brutalism-input"
                            />
                            <p className="text-[10px] font-bold text-black opacity-60">Switching providers generally requires refreshing to ensure the correct model is loaded, but updating the key works instantly.</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <label className="text-xs font-black text-black uppercase tracking-widest block flex items-center gap-2">
                                <Globe className="w-4 h-4" /> OpenRouter API Key
                            </label>
                            <input
                                type="password"
                                value={openRouterKey}
                                onChange={(e) => setOpenRouterKey(e.target.value)}
                                placeholder="sk-or-..."
                                className="w-full p-4 text-sm font-bold bg-white border-[3px] border-black outline-none focus:bg-secondary transition-colors placeholder:text-black/30 neo-brutalism-input"
                            />
                        </div>
                    )}

                </div>

                {/* Footer */}
                <footer className="p-6 border-t-[4px] border-black bg-slate-50 flex justify-end gap-4">
                    <Button onClick={onClose} variant="outline" size="sm">Cancel</Button>
                    <Button onClick={handleSave} variant="primary" size="sm">
                        <Save className="w-4 h-4 mr-2" />
                        Save Settings
                    </Button>
                </footer>

            </div>
        </div>
    );
};
