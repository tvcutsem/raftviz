const THEMES = {
  dark: {
    bg:                    '#1a1a2e',
    surface:               '#16213e',
    border:                '#0f3460',
    text:                  '#eaeaea',
    textMuted:             '#8892a4',
    accent:                '#e94560',
    follower:              '#4682b4',
    candidate:             '#f0a500',
    leader:                '#2ecc71',
    stopped:               '#888888',
    msgVoteReq:            '#f0a500',
    msgVoteOk:             '#009e73',
    msgVoteKo:             '#d55e00',
    msgLogReq:             '#4682b4',
    msgLogOk:              '#009e73',
    msgLogKo:              '#d55e00',
    logUncommitted:        '#fffacd',
    logCommitted:          '#27ae60',
    logCommittedText:      '#ffffff',
    logUncommittedText:    '#1a1a2e',
    logTermCommitted:      '#a8e6cf',
    logTermUncommitted:    '#555555',
    commitMarker:          '#2ecc71',
    electionArc:           '#e0c060',
    flashRing:             '#ffffff',
    nodeLabel:             '#ffffff',
    nodeBadge:             '#8892a4',
    inspectorBg:           '#0f3460',
    inspectorKey:          '#8892a4',
    inspectorChanged:      '#f0a500',
    inspectorValue:        '#eaeaea',
    statemachineBg:        '#0a2240',
    statemachineHead:      '#8892a4',
    statemachineEmpty:     '#8892a4',
    statemachineKey:       '#a8e6cf',
    statemachineEq:        '#8892a4',
    statemachineVal:       '#eaeaea',
    arrowGray:             '#8892a4',
  },
  light: {
    bg:                    '#ffffff',
    surface:               '#f0f2f8',
    border:                '#c0c8d8',
    text:                  '#1a1a2e',
    textMuted:             '#555e72',
    accent:                '#c0392b',
    follower:              '#0072b2',   // Okabe-Ito blue
    candidate:             '#e69f00',   // Okabe-Ito orange
    leader:                '#009e73',   // Okabe-Ito green
    stopped:               '#666666',
    msgVoteReq:            '#e69f00',
    msgVoteOk:             '#009e73',
    msgVoteKo:             '#d55e00',   // Okabe-Ito vermilion
    msgLogReq:             '#0072b2',
    msgLogOk:              '#009e73',
    msgLogKo:              '#d55e00',
    logUncommitted:        '#fff3cd',
    logCommitted:          '#006838',
    logCommittedText:      '#ffffff',
    logUncommittedText:    '#1a1a2e',
    logTermCommitted:      '#ffffff',
    logTermUncommitted:    '#555555',
    commitMarker:          '#009e73',
    electionArc:           '#e69f00',
    flashRing:             '#333333',
    nodeLabel:             '#ffffff',
    nodeBadge:             '#555e72',
    inspectorBg:           '#e4eaf8',
    inspectorKey:          '#555e72',
    inspectorChanged:      '#e69f00',
    inspectorValue:        '#1a1a2e',
    statemachineBg:        '#dce8f8',
    statemachineHead:      '#555e72',
    statemachineEmpty:     '#888888',
    statemachineKey:       '#005f40',
    statemachineEq:        '#555e72',
    statemachineVal:       '#1a1a2e',
    arrowGray:             '#555e72',
  },
};

export const getTheme = () => THEMES[document.documentElement.dataset.theme ?? 'light'];

export const setTheme = name => {
  document.documentElement.dataset.theme = name;
  localStorage.setItem('raft-theme', name);
};

export const initTheme = () => {
  const saved = localStorage.getItem('raft-theme') ?? 'light';
  document.documentElement.dataset.theme = saved;
  return saved;
};
