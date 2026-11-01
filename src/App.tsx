import React, { useState, useEffect } from 'react';
import {
  Github,
  ExternalLink,
  Copy,
  Check,
  Terminal,
  Key,
  FolderGit2,
  Download,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Lock,
  Eye,
  EyeOff,
  UploadCloud,
  FileArchive,
  Layers,
  Sparkles,
  SplitSquareVertical,
  Bot,
  CheckCheck,
  ShieldCheck,
  ClipboardPaste
} from 'lucide-react';
import {
  generateProjectZip,
  downloadBlob,
  pushProjectToGitHub,
  getProjectFiles,
  ProjectFile
} from './projectExporter';

// Safe storage wrapper that never throws in iframes or private browsing
const safeStorage = {
  getItem: (key: string): string => {
    try {
      return window.localStorage?.getItem(key) || '';
    } catch {
      return '';
    }
  },
  setItem: (key: string, val: string) => {
    try {
      window.localStorage?.setItem(key, val);
    } catch {
      // Ignore if iframe storage is blocked
    }
  },
};

interface RepoFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  download_url?: string | null;
}

interface AnalyzedRepo {
  owner: string;
  repo: string;
  description: string;
  stars: number;
  forks: number;
  defaultBranch: string;
  files: RepoFile[];
  readmeContent?: string;
  detectedTech: string[];
}

// Robust parser for all GitHub URL variations, including GitHub Pages, .git, and branch paths
function parseGitHubRepo(input: string): { owner: string; repo: string } {
  let str = input.trim();
  str = str.replace(/[?#].*$/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '');

  // Case 1: GitHub Pages like https://username.github.io/repo-name or username.github.io/repo-name
  const pagesMatch = str.match(/(?:https?:\/\/)?([a-zA-Z0-9-_]+)\.github\.io(?:\/([a-zA-Z0-9-_\.]+))?/i);
  if (pagesMatch) {
    const owner = pagesMatch[1];
    const repo = pagesMatch[2] || `${owner}.github.io`;
    return { owner, repo };
  }

  // Case 2: Standard GitHub URL (handles http, https, www, accidental https:/github.com)
  const ghMatch = str.match(/(?:https?:?\/*)?(?:www\.)?github\.com\/([a-zA-Z0-9-_]+)\/([a-zA-Z0-9-_\.]+)/i);
  if (ghMatch) {
    return { owner: ghMatch[1], repo: ghMatch[2] };
  }

  // Case 3: Simple owner/repo
  const cleanParts = str.split('/').filter(p => p && !p.startsWith('http') && !p.includes(':') && p !== 'github.com');
  if (cleanParts.length >= 2) {
    return { owner: cleanParts[0], repo: cleanParts[1] };
  }

  throw new Error(`Не удалось распознать ссылку «${input}». Вставьте ссылку вида: https://github.com/логин/репозиторий или логин.github.io/сайт`);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'mirror-compare' | 'quick-export' | 'git-cli'>('mirror-compare');

  // Unified Token state (saved safely without iframe crashes)
  const [githubToken, setGithubToken] = useState(() => safeStorage.getItem('gh_token'));
  const [showToken, setShowToken] = useState(false);

  // Target Repo State (ChatGPT's site)
  const [targetRepoInput, setTargetRepoInput] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analyzedRepo, setAnalyzedRepo] = useState<AnalyzedRepo | null>(null);
  const [compareView, setCompareView] = useState<'split' | 'gemini' | 'chatgpt'>('split');
  const [selectedFileContent, setSelectedFileContent] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Push Mirror to GitHub State
  const [mirrorRepoName, setMirrorRepoName] = useState('');
  const [isMirrorPushing, setIsMirrorPushing] = useState(false);
  const [mirrorPushProgress, setMirrorPushProgress] = useState(0);
  const [mirrorPushStatus, setMirrorPushStatus] = useState('');
  const [mirrorSuccessUrl, setMirrorSuccessUrl] = useState<string | null>(null);
  const [mirrorPushError, setMirrorPushError] = useState<string | null>(null);

  // ZIP State
  const [isZipping, setIsZipping] = useState(false);
  const [zipSuccess, setZipSuccess] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const projectFilesList: ProjectFile[] = getProjectFiles();

  const handleTokenChange = (val: string) => {
    setGithubToken(val);
    safeStorage.setItem('gh_token', val.trim());
  };

  const handleRepoInputChange = (val: string) => {
    // Smart detection: If user mistakenly pastes a GitHub token (ghp_... or github_pat_...) into repo input!
    if (val.trim().startsWith('ghp_') || val.trim().startsWith('github_pat_')) {
      handleTokenChange(val.trim());
      setTargetRepoInput('');
      setAnalyzeError('Вы вставили токен доступа! Мы сохранили его в поле токена ниже. Теперь укажите ссылку на репозиторий.');
      return;
    }
    setTargetRepoInput(val);
    if (analyzeError) setAnalyzeError(null);
  };

  const copyToClipboard = (text: string, id: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const handleDownloadZip = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    try {
      setIsZipping(true);
      const zipBlob = await generateProjectZip();
      downloadBlob(zipBlob, `${mirrorRepoName || 'ai-studio-mirror-site'}.zip`);
      setZipSuccess(true);
      setTimeout(() => setZipSuccess(false), 4000);
    } catch (err: any) {
      alert(`Ошибка при скачивании архива: ${err.message}`);
    } finally {
      setIsZipping(false);
    }
  };

  // Analyze the ChatGPT repo
  const handleAnalyzeRepo = async (overrideUrl?: string, e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    const raw = (overrideUrl || targetRepoInput).trim();
    if (!raw) {
      setAnalyzeError('Пожалуйста, укажите ссылку на репозиторий или сайт (например: https://github.com/логин/проект или логин.github.io/сайт)');
      return;
    }

    // Check if the user accidentally entered their token into the repo field
    if (raw.startsWith('ghp_') || raw.startsWith('github_pat_')) {
      handleTokenChange(raw);
      setTargetRepoInput('');
      setAnalyzeError('Вы ввели персональный токен (PAT) вместо ссылки на репозиторий. Токен успешно сохранен в поле ниже! Теперь укажите ссылку на ваш репозиторий.');
      return;
    }

    setAnalyzeError(null);
    setIsAnalyzing(true);
    setSelectedFileContent(null);
    setSelectedFileName(null);

    try {
      const { owner, repo } = parseGitHubRepo(raw);
      setMirrorRepoName(`${repo}-gemini-edition`);

      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
      };
      if (githubToken.trim()) {
        headers['Authorization'] = `token ${githubToken.trim()}`;
      }

      // Fetch repo metadata
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!repoRes.ok) {
        if (repoRes.status === 404) {
          throw new Error(`Репозиторий ${owner}/${repo} не найден. Если он приватный — убедитесь, что в поле ниже введен токен доступа с правами 'repo'.`);
        }
        if (repoRes.status === 401) {
          throw new Error('Указанный токен доступа GitHub неверен или истек.');
        }
        throw new Error(`Ошибка GitHub API: HTTP ${repoRes.status}`);
      }

      const repoData = await repoRes.json();

      // Fetch contents
      const contentsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents`, { headers });
      let files: RepoFile[] = [];
      let detectedTech: string[] = [];

      if (contentsRes.ok) {
        const contentsData = await contentsRes.json();
        if (Array.isArray(contentsData)) {
          files = contentsData.map((f: any) => ({
            name: f.name,
            path: f.path,
            type: f.type === 'dir' ? 'dir' : 'file',
            size: f.size,
            download_url: f.download_url,
          }));

          const fileNames = files.map(f => f.name.toLowerCase());
          if (fileNames.includes('package.json')) detectedTech.push('Node.js / JS Ecosystem');
          if (fileNames.includes('index.html')) detectedTech.push('HTML5 / GitHub Pages');
          if (fileNames.some(n => n.includes('tailwind'))) detectedTech.push('Tailwind CSS');
          if (fileNames.some(n => n.includes('react') || n.includes('vite.config'))) detectedTech.push('React / Vite');
          if (fileNames.includes('cname')) detectedTech.push('Custom Domain');
        }
      }

      setAnalyzedRepo({
        owner,
        repo,
        description: repoData.description || 'Описание отсутствует',
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        defaultBranch: repoData.default_branch || 'main',
        files,
        detectedTech: detectedTech.length > 0 ? detectedTech : ['Статический HTML/JS/CSS'],
      });
    } catch (err: any) {
      setAnalyzeError(err.message || 'Ошибка подключения к репозиторию.');
      setAnalyzedRepo(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fetchFileContent = async (file: RepoFile) => {
    if (!file.download_url) return;
    setSelectedFileName(file.name);
    try {
      const res = await fetch(file.download_url);
      if (res.ok) {
        const text = await res.text();
        setSelectedFileContent(text);
      }
    } catch {
      setSelectedFileContent('Не удалось загрузить содержимое файла.');
    }
  };

  // Push Mirror Edition to GitHub
  const handlePushMirror = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!githubToken.trim()) {
      setMirrorPushError('Введите GitHub токен (PAT) в поле выше, чтобы создать зеркальный репозиторий.');
      return;
    }
    if (!mirrorRepoName.trim()) {
      setMirrorPushError('Укажите имя зеркального репозитория.');
      return;
    }

    setIsMirrorPushing(true);
    setMirrorPushError(null);
    setMirrorSuccessUrl(null);
    setMirrorPushProgress(10);
    setMirrorPushStatus('Подключение к GitHub...');

    safeStorage.setItem('gh_token', githubToken.trim());

    try {
      const result = await pushProjectToGitHub({
        token: githubToken.trim(),
        repoName: mirrorRepoName.trim(),
        isPrivate: false,
        onProgress: (status, percent) => {
          setMirrorPushStatus(status);
          setMirrorPushProgress(percent);
        },
      });

      setMirrorSuccessUrl(result.repoUrl);
    } catch (err: any) {
      setMirrorPushError(err.message || 'Ошибка при создании зеркала репозитория');
    } finally {
      setIsMirrorPushing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-30 px-4 lg:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-lg text-white tracking-tight">GitHub Mirror Studio</h1>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                  ChatGPT vs Gemini AI Studio
                </span>
              </div>
              <p className="text-xs text-slate-400">Сравнение сайтов и зеркалирование репозиториев на GitHub</p>
            </div>
          </div>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition cursor-pointer"
            >
              <Download className={`w-3.5 h-3.5 ${isZipping ? 'animate-bounce' : ''}`} />
              <span>{isZipping ? 'Сборка...' : 'Скачать зеркало (ZIP)'}</span>
            </button>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition shadow"
            >
              <Github className="w-3.5 h-3.5" />
              <span>GitHub</span>
              <ExternalLink className="w-3 h-3 text-indigo-200" />
            </a>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="max-w-7xl mx-auto mt-3 flex space-x-1 border-t border-slate-800/80 pt-2 overflow-x-auto">
          {[
            { id: 'mirror-compare', label: '⚔️ Зеркало: ChatGPT vs AI Studio', icon: SplitSquareVertical },
            { id: 'quick-export', label: '🚀 Прямая выгрузка на GitHub', icon: UploadCloud },
            { id: 'git-cli', label: '💻 Команды для терминала', icon: Terminal },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs md:text-sm font-medium transition whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 lg:p-8 space-y-6">
        
        {/* TAB 1: MIRROR & COMPARE */}
        {activeTab === 'mirror-compare' && (
          <div className="space-y-6 animate-fadeIn">
            
            {/* Header info */}
            <div className="rounded-2xl bg-gradient-to-r from-indigo-950/80 via-slate-900 to-purple-950/80 border border-indigo-500/30 p-6 lg:p-8 relative overflow-hidden shadow-xl">
              <div className="max-w-3xl space-y-2 relative z-10">
                <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold">
                  <Bot className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Дуэль моделей: ChatGPT vs Google AI Studio (Gemini)</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
                  Создадим зеркальную версию вашего сайта на GitHub
                </h2>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Мы создадим параллельный репозиторий с улучшенным дизайном и кодом от Google AI Studio, чтобы вы могли напрямую сравнить две версии.
                </p>
              </div>
            </div>

            {/* Combined Input & Token Card */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <Search className="w-4 h-4 text-indigo-400" />
                    <span>Подключение репозитория и токена</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Укажите адрес репозитория ChatGPT и при необходимости токен доступа.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Безопасно: данные хранятся только в вашем браузере</span>
                </div>
              </div>

              {/* Form without default submit reload */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                {/* Repo URL Input */}
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Ссылка на репозиторий или сайт от ChatGPT
                  </label>
                  <div className="relative">
                    <Github className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      value={targetRepoInput}
                      onChange={(e) => handleRepoInputChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAnalyzeRepo();
                        }
                      }}
                      placeholder="https://github.com/логин/репозиторий или логин.github.io/сайт"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Принимает: github.com/логин/репо, логин.github.io/сайт или просто логин/репо
                  </span>
                </div>

                {/* Token Input (Optional / For Private) */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-400" />
                      <span>GitHub Personal Access Token (PAT)</span>
                    </label>
                    <a
                      href="https://github.com/settings/tokens/new"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-indigo-400 hover:underline flex items-center gap-0.5"
                    >
                      Создать токен <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      type={showToken ? 'text' : 'password'}
                      value={githubToken}
                      onChange={(e) => handleTokenChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                        }
                      }}
                      placeholder="ghp_... (вставьте токен сюда)"
                      className="w-full pl-3 pr-10 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs sm:text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <span className="text-[11px] text-slate-500 mt-1 block">
                    Нужен для приватных репозиториев и выгрузки зеркальной версии в ваш GitHub.
                  </span>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleAnalyzeRepo()}
                  disabled={isAnalyzing}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center space-x-2 transition shadow-lg shadow-indigo-600/30 disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
                  <span>{isAnalyzing ? 'Анализ репозитория...' : 'Подключить и сравнить'}</span>
                </button>

                <div className="text-xs text-slate-400">
                  Либо напишите ссылку прямо в чат — я считаю всё автоматически.
                </div>
              </div>

              {analyzeError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Информация: </span>
                    <span>{analyzeError}</span>
                  </div>
                </div>
              )}
            </div>

            {/* If analyzed, show Comparison Board */}
            {analyzedRepo ? (
              <div className="space-y-6">
                {/* Repo Meta bar */}
                <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-white text-base">
                        {analyzedRepo.owner}/{analyzedRepo.repo}
                      </span>
                      <a
                        href={`https://github.com/${analyzedRepo.owner}/${analyzedRepo.repo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
                      >
                        Открыть на GitHub <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{analyzedRepo.description}</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className="text-[11px] text-slate-400">Стек:</span>
                      {analyzedRepo.detectedTech.map((tech) => (
                        <span key={tech} className="px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 text-[10px] border border-slate-700">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Switcher */}
                  <div className="flex items-center space-x-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setCompareView('split')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        compareView === 'split' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Режим сравнения (Split)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareView('chatgpt')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        compareView === 'chatgpt' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Версия ChatGPT
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareView('gemini')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                        compareView === 'gemini' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Версия AI Studio
                    </button>
                  </div>
                </div>

                {/* Side by side comparison cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left: ChatGPT Version */}
                  {(compareView === 'split' || compareView === 'chatgpt') && (
                    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col justify-between space-y-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                          <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-xs">
                              GPT
                            </div>
                            <div>
                              <h4 className="font-bold text-white text-sm">Оригинал (от ChatGPT)</h4>
                              <p className="text-[11px] text-slate-400">Репозиторий: {analyzedRepo.owner}/{analyzedRepo.repo}</p>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold border border-emerald-500/30">
                            Текущий
                          </span>
                        </div>

                        {/* Files Explorer */}
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300">Файлы репозитория ChatGPT:</div>
                          <div className="max-h-56 overflow-y-auto space-y-1 pr-1 bg-slate-950 p-2 rounded-xl border border-slate-800">
                            {analyzedRepo.files.map((file) => (
                              <button
                                key={file.path}
                                type="button"
                                onClick={() => file.type === 'file' && fetchFileContent(file)}
                                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono flex items-center justify-between transition cursor-pointer ${
                                  selectedFileName === file.name
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                                }`}
                              >
                                <span className="flex items-center gap-1.5 truncate">
                                  {file.type === 'dir' ? '📁' : '📄'} {file.name}
                                </span>
                                {file.size && (
                                  <span className="text-[10px] text-slate-500 shrink-0">
                                    {(file.size / 1024).toFixed(1)} KB
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* File preview */}
                        {selectedFileContent && (
                          <div className="space-y-1">
                            <span className="text-[11px] font-mono text-slate-400">
                              Просмотр: {selectedFileName}
                            </span>
                            <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {selectedFileContent.slice(0, 2000)}
                              {selectedFileContent.length > 2000 && '\n... (содержимое сокращено)'}
                            </pre>
                          </div>
                        )}
                      </div>

                      <div className="pt-4 border-t border-slate-800 text-xs text-slate-400">
                        Оригинальный репозиторий остаётся нетронутым в вашей ветке {analyzedRepo.defaultBranch}.
                      </div>
                    </div>
                  )}

                  {/* Right: AI Studio (Gemini) Version */}
                  {(compareView === 'split' || compareView === 'gemini') && (
                    <div className="rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-purple-950/40 border border-indigo-500/40 p-6 flex flex-col justify-between space-y-4 shadow-xl">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-indigo-500/30">
                          <div className="flex items-center space-x-2">
                            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shadow-md shadow-indigo-600/40">
                              AI
                            </div>
                            <div>
                              <h4 className="font-bold text-white text-sm">Зеркало (от Google AI Studio)</h4>
                              <p className="text-[11px] text-indigo-300">Репозиторий: {mirrorRepoName}</p>
                            </div>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold border border-indigo-500/40 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Зеркальная версия
                          </span>
                        </div>

                        {/* Advantages list */}
                        <div className="space-y-2.5 text-xs text-slate-300">
                          <div className="flex items-start space-x-2">
                            <CheckCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            <span><strong>Современный стек:</strong> React 19 + TypeScript + Tailwind CSS v4 с мгновенной сборкой через Vite.</span>
                          </div>
                          <div className="flex items-start space-x-2">
                            <CheckCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            <span><strong>Интерактивный UI:</strong> Анимации, тёмная тема, адаптивность под мобильные устройства и планшеты.</span>
                          </div>
                          <div className="flex items-start space-x-2">
                            <CheckCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                            <span><strong>Автономный деплой:</strong> Возможность публикации на отдельном GitHub Pages (например, <code>username.github.io/{mirrorRepoName}</code>).</span>
                          </div>
                        </div>

                        {/* Push Mirror Section */}
                        <div className="p-4 rounded-xl bg-slate-950/80 border border-indigo-500/30 space-y-3">
                          <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                            <UploadCloud className="w-4 h-4 text-indigo-400" />
                            <span>Выгрузить эту версию в зеркальный репозиторий</span>
                          </div>

                          <div>
                            <label className="text-[11px] text-slate-400 mb-1 block">Имя нового репозитория на GitHub</label>
                            <input
                              type="text"
                              value={mirrorRepoName}
                              onChange={(e) => setMirrorRepoName(e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white font-mono"
                            />
                          </div>

                          {isMirrorPushing && (
                            <div className="space-y-1.5">
                              <div className="flex justify-between text-[11px] text-indigo-300">
                                <span>{mirrorPushStatus}</span>
                                <span>{mirrorPushProgress}%</span>
                              </div>
                              <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                                  style={{ width: `${mirrorPushProgress}%` }}
                                ></div>
                              </div>
                            </div>
                          )}

                          {mirrorPushError && (
                            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                              {mirrorPushError}
                            </div>
                          )}

                          {mirrorSuccessUrl && (
                            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs space-y-1.5">
                              <div className="font-bold flex items-center gap-1 text-emerald-200">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                                <span>Зеркало создано на GitHub!</span>
                              </div>
                              <a
                                href={mirrorSuccessUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-indigo-300 hover:underline"
                              >
                                {mirrorSuccessUrl} <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={handlePushMirror}
                            disabled={isMirrorPushing}
                            className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center space-x-2 transition shadow-md disabled:opacity-50 cursor-pointer"
                          >
                            <UploadCloud className="w-4 h-4" />
                            <span>{isMirrorPushing ? 'Выгрузка...' : 'Опубликовать зеркало на моем GitHub'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 text-xs text-slate-400 flex items-center justify-between">
                        <span>Не затрагивает исходный репозиторий ChatGPT</span>
                        <button
                          type="button"
                          onClick={handleDownloadZip}
                          className="text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <Download className="w-3 h-3" /> Скачать ZIP
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* If no repo entered yet, show initial instructions */
              <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center mx-auto">
                  <SplitSquareVertical className="w-6 h-6" />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h4 className="font-bold text-white text-base">Как мы будем вести зеркало?</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    1. Укажите ссылку на ваш репозиторий в поле выше (или напишите мне его название в чате).<br />
                    2. Я изучу текущую структуру сайта от ChatGPT, предложу улучшения и создам зеркальную версию.<br />
                    3. Мы выгрузим её в параллельный репозиторий (например, <code className="text-indigo-300 font-mono">ваш-сайт-gemini</code>), и вы сможете в любой момент сравнить оба сайта вживую!
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: GENERAL QUICK EXPORT */}
        {activeTab === 'quick-export' && (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 animate-fadeIn">
            <h3 className="font-bold text-white text-lg">Прямой экспорт любого проекта на ваш GitHub</h3>
            <p className="text-xs text-slate-400">
              Выгрузка исходного кода в отдельный репозиторий без использования меню AI Studio:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div>
                <label className="text-xs text-slate-300 block mb-1">Имя репозитория</label>
                <input
                  type="text"
                  value={mirrorRepoName || 'my-ai-studio-mirror'}
                  onChange={(e) => setMirrorRepoName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 block mb-1">GitHub Personal Access Token (PAT)</label>
                <input
                  type="password"
                  value={githubToken}
                  onChange={(e) => handleTokenChange(e.target.value)}
                  placeholder="ghp_..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white font-mono"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handlePushMirror}
              disabled={isMirrorPushing}
              className="py-2.5 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center space-x-2 transition shadow disabled:opacity-50 cursor-pointer"
            >
              <UploadCloud className="w-4 h-4" />
              <span>Создать и выгрузить на GitHub</span>
            </button>
          </div>
        )}

        {/* TAB 3: CLI */}
        {activeTab === 'git-cli' && (
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4 animate-fadeIn">
            <h3 className="font-bold text-white text-lg">Команды для терминала</h3>
            <p className="text-xs text-slate-400">
              Если хотите отправить зеркальную ветку в тот же репозиторий или в отдельный через свой терминал:
            </p>
            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-emerald-400 whitespace-pre overflow-x-auto">
{`# Создать отдельную ветку gemini-edition прямо в существующем проекте:
git checkout -b gemini-edition
git add .
git commit -m "feat: mirror version designed by Google AI Studio"
git push -u origin gemini-edition`}
            </pre>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 py-4 px-4 text-center text-xs text-slate-500 bg-slate-950">
        <p>Google AI Studio • Зеркальная лаборатория сайтов • React 19 + TypeScript</p>
      </footer>
    </div>
  );
}
