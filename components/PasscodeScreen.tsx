import React, { useState } from 'react';
import { Lock, Key, ArrowRight, AlertTriangle, Settings2 } from 'lucide-react';
import { Button } from './Button';
import { validatePasscode } from '../utils/authUtils';

interface PasscodeScreenProps {
    onAuthenticated: (keys: { openRouterApiKey: string; sarvamApiKey: string }) => void;
    onManualMode: () => void;
}

export const PasscodeScreen: React.FC<PasscodeScreenProps> = ({ onAuthenticated, onManualMode }) => {
    const [passcode, setPasscode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setIsChecking(true);
        setError(null);

        // Small delay for UX feedback
        setTimeout(() => {
            const result = validatePasscode(passcode);
            if (result) {
                onAuthenticated(result);
            } else {
                setError('Incorrect passcode. Please try again.');
                setPasscode('');
            }
            setIsChecking(false);
        }, 300);
    };

    return (
        <div className="min-h-screen flex items-center justify-center px-6 py-16" style={{ background: 'linear-gradient(135deg, #f8f8f8 0%, #e8e8e8 100%)' }}>
            <div className="w-full max-w-md space-y-8">
                {/* Logo & Title */}
                <div className="text-center space-y-4">
                    <div className="inline-flex items-center justify-center mb-2">
                        <img
                            src="https://raw.githubusercontent.com/shashwatsingh1315/refined-bars-ai/Experimental/public/kimbal-logo.png"
                            alt="Kimbal Logo"
                            className="h-16 w-auto"
                            onError={(e) => {
                                e.currentTarget.style.display = 'none';
                            }}
                        />
                    </div>
                    <h1 className="text-4xl font-black text-black uppercase tracking-tighter">
                        BARS Interview Tool
                    </h1>
                    <p className="text-sm font-bold text-black/60">
                        Enter your access code to continue
                    </p>
                </div>

                {/* Passcode Form */}
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="bg-white border-[3px] border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
                        <div className="px-6 py-4 border-b-[3px] border-black bg-secondary flex items-center gap-2">
                            <Lock className="w-4 h-4 text-black" />
                            <span className="text-xs font-black text-black uppercase tracking-widest">Access Code</span>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="relative">
                                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-black z-10" />
                                <input
                                    type="password"
                                    value={passcode}
                                    onChange={(e) => { setPasscode(e.target.value); setError(null); }}
                                    placeholder="Enter passcode..."
                                    className="neo-brutalism-input pl-12 text-lg tracking-widest"
                                    autoFocus
                                    disabled={isChecking}
                                />
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 text-black text-xs font-black uppercase bg-tertiary p-3 border-2 border-black">
                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                    {error}
                                </div>
                            )}

                            <Button
                                type="submit"
                                size="lg"
                                disabled={!passcode || isChecking}
                                className="w-full h-14 text-base"
                            >
                                {isChecking ? 'Checking...' : 'Unlock'}
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </div>
                    </div>
                </form>

                {/* Manual Mode Link */}
                <div className="text-center">
                    <button
                        onClick={onManualMode}
                        className="inline-flex items-center gap-2 text-xs font-bold text-black/40 hover:text-black transition-colors uppercase tracking-wider group"
                    >
                        <Settings2 className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-300" />
                        Advanced: Enter API keys manually
                    </button>
                </div>
            </div>
        </div>
    );
};
