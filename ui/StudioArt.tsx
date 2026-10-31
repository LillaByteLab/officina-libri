import React from 'react';

export function StudioIcon({name,className=''}:{name:string;className?:string}){
 const paths:Record<string,React.ReactNode>={
  book:<><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15M6 8h3M6 12h3M15 8h3M15 12h3"/></>,
  image:<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></>,
  moon:<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>,
  sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
  folder:<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3V7h18"/>,
  shield:<><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,
  plus:<path d="M12 4v16M4 12h16"/>,
 };
 return <svg className={'studio-icon '+className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]||paths.book}</svg>;
}

export default function StudioArt(){return <svg className="studio-art" viewBox="0 0 480 300" aria-hidden="true" focusable="false">
 <ellipse cx="248" cy="152" rx="174" ry="129" fill="var(--art-halo)"/>
 <path d="M59 226c74 35 241 39 353-4" stroke="var(--border)" strokeWidth="1.5" fill="none"/>
 <g transform="rotate(-7 230 220)"><rect x="106" y="217" width="264" height="25" rx="7" fill="var(--art-petrol)"/><path d="M129 221h232v14H129" fill="var(--art-paper)"/><path d="M139 228h212" stroke="var(--art-line)" strokeWidth="1.5"/><rect x="104" y="217" width="25" height="25" rx="6" fill="var(--art-petrol)"/></g>
 <g transform="rotate(4 249 192)"><rect x="126" y="190" width="244" height="25" rx="6" fill="var(--art-coral)"/><path d="M150 194h211v14H150" fill="var(--art-paper)"/><path d="M159 201h194" stroke="var(--art-line)" strokeWidth="1.5"/></g>
 <g transform="rotate(-9 242 130)"><path d="M127 60c44-12 84-8 117 14 36-19 74-22 116-9v136c-43-12-80-10-116 8-35-19-75-21-117-10Z" fill="var(--art-lilac)" stroke="var(--art-lilac)" strokeWidth="10" strokeLinejoin="round"/>
 <path d="M128 59c44-12 83-8 116 14v127c-35-19-73-21-116-10Z" fill="var(--art-paper)"/><path d="M244 73c35-20 74-23 116-9v127c-42-12-80-9-116 9Z" fill="var(--art-page)"/>
 <path d="M244 75v124" stroke="var(--art-line)" strokeWidth="1.3"/>
 <g fill="none" stroke="var(--art-line)" strokeWidth="2.3" strokeLinecap="round"><path d="M149 91c25-3 47 1 71 13M149 109c25-3 47 1 71 13M149 127c25-3 47 1 71 13M149 145c25-3 47 1 71 13M149 163c18-2 32 0 46 5M269 101c22-8 43-10 65-7M269 119c22-8 43-10 65-7M269 137c22-8 43-10 65-7M269 155c22-8 43-10 65-7M269 173c13-5 24-7 36-7"/></g>
 <path d="m310 65 19 1v53l-9-7-10 6Z" fill="var(--art-coral)"/></g>
 <g stroke="var(--art-petrol)" strokeWidth="2" strokeLinecap="round"><path d="M90 104v14m-7-7h14M382 152v10m-5-5h10"/></g><circle cx="375" cy="61" r="7" fill="var(--art-coral)"/><circle cx="103" cy="167" r="4" fill="var(--art-lilac)"/>
 </svg>;}
