import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const App = () => {
  const containerRef = useRef(null);
  const [wind, setWind] = useState(1.5);
  const [sunAngle, setSunAngle] = useState(0.5); // 0 = East, 0.5 = Noon, 1 = West
  const [isNight, setIsNight] = useState(false);
  const [showUI, setShowUI] = useState(true);
  const [isSoundOn, setIsSoundOn] = useState(false);
  
  const windRef = useRef(1.5);
  const sunAngleRef = useRef(0.5);
  const isNightRef = useRef(false);
  const isSoundOnRef = useRef(false);
  const sunLightRef = useRef(null);
  const ambientLightRef = useRef(null);
  const sceneRef = useRef(null);
  const audioContextRef = useRef(null);
  const windGainRef = useRef(null);
  const masterGainRef = useRef(null);
  const highPassRef = useRef(null);
  const lowPassRef = useRef(null);
  const noiseSourceRef = useRef(null);
  const lfoRef = useRef(null);
  const lfoDepthRef = useRef(null);
  const birdGainRef = useRef(null);
  const birdTimerRef = useRef(null);
  const suspendTimeoutRef = useRef(null);

  const getBirdProfile = (nightMode, angle) => {
    if (nightMode || angle < 0.08 || angle > 0.92) {
      return { activity: 0.03, minDelay: 9000, maxDelay: 16000, mix: [0.2, 0.1, 0.7] };
    }
    if (angle < 0.3) {
      return { activity: 0.95, minDelay: 1400, maxDelay: 3400, mix: [0.5, 0.35, 0.15] };
    }
    if (angle < 0.72) {
      return { activity: 0.6, minDelay: 2500, maxDelay: 5200, mix: [0.35, 0.45, 0.2] };
    }
    return { activity: 0.3, minDelay: 3600, maxDelay: 7000, mix: [0.25, 0.25, 0.5] };
  };

  const weightedSpecies = (mix) => {
    const r = Math.random();
    if (r < mix[0]) return 'warbler';
    if (r < mix[0] + mix[1]) return 'sparrow';
    return 'dove';
  };

  const playNote = (ctx, destination, startAt, note) => {
    const osc = ctx.createOscillator();
    const toneFilter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = note.type;
    osc.frequency.setValueAtTime(note.freq, startAt);
    if (note.glideTo) {
      osc.frequency.exponentialRampToValueAtTime(note.glideTo, startAt + note.duration);
    }

    toneFilter.type = 'bandpass';
    toneFilter.frequency.value = note.filter;
    toneFilter.Q.value = 4.5;

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(note.peak, startAt + note.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + note.duration);

    osc.connect(toneFilter);
    toneFilter.connect(gain);
    gain.connect(destination);

    osc.start(startAt);
    osc.stop(startAt + note.duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      toneFilter.disconnect();
      gain.disconnect();
    };
  };

  const playBirdCall = (ctx, windValue, profile) => {
    const birdGain = birdGainRef.current;
    if (!birdGain) return;
    const species = weightedSpecies(profile.mix);
    const now = ctx.currentTime + 0.02;
    const breezeSoftener = Math.max(0.65, 1 - windValue * 0.09);

    if (species === 'warbler') {
      const base = 1700 + Math.random() * 350;
      const sequence = [0, 0.08, 0.17, 0.28].map((offset, idx) => ({
        start: offset,
        freq: base * (1 + idx * 0.14),
        glideTo: base * (1.08 + idx * 0.08),
        duration: 0.11,
        attack: 0.02,
        peak: 0.08 * breezeSoftener,
        filter: 2600,
        type: 'triangle'
      }));
      sequence.forEach((note) => playNote(ctx, birdGain, now + note.start, note));
      return;
    }

    if (species === 'sparrow') {
      const base = 2200 + Math.random() * 500;
      const sequence = [0, 0.06, 0.13, 0.2, 0.28].map((offset, idx) => ({
        start: offset,
        freq: base * (idx % 2 === 0 ? 1 : 0.9),
        glideTo: base * (idx % 2 === 0 ? 1.04 : 0.95),
        duration: 0.07,
        attack: 0.01,
        peak: 0.06 * breezeSoftener,
        filter: 3200,
        type: 'square'
      }));
      sequence.forEach((note) => playNote(ctx, birdGain, now + note.start, note));
      return;
    }

    const base = 520 + Math.random() * 160;
    const sequence = [0, 0.34].map((offset, idx) => ({
      start: offset,
      freq: base * (idx === 0 ? 1.12 : 1),
      glideTo: base * 0.82,
      duration: 0.38,
      attack: 0.07,
      peak: 0.045 * breezeSoftener,
      filter: 860,
      type: 'sine'
    }));
    sequence.forEach((note) => playNote(ctx, birdGain, now + note.start, note));
  };

  const clearBirdTimer = () => {
    if (birdTimerRef.current) {
      window.clearTimeout(birdTimerRef.current);
      birdTimerRef.current = null;
    }
  };

  const scheduleBirds = () => {
    clearBirdTimer();
    const ctx = audioContextRef.current;
    const birdGain = birdGainRef.current;
    if (!ctx || !birdGain || !isSoundOnRef.current || ctx.state !== 'running') return;

    const profile = getBirdProfile(isNightRef.current, sunAngleRef.current);
    const windValue = windRef.current;
    const windMask = Math.max(0.45, 1 - windValue * 0.1);
    const chirpProbability = profile.activity * windMask;
    const now = ctx.currentTime;

    birdGain.gain.setTargetAtTime(0.8 + profile.activity * 0.6, now, 0.5);
    if (Math.random() < chirpProbability) {
      playBirdCall(ctx, windValue, profile);
    }

    const delayRange = profile.maxDelay - profile.minDelay;
    const nextDelay = profile.minDelay + Math.random() * delayRange;
    birdTimerRef.current = window.setTimeout(scheduleBirds, nextDelay);
  };

  const updateWindAudio = (windValue, soundEnabled) => {
    const ctx = audioContextRef.current;
    const windGain = windGainRef.current;
    const masterGain = masterGainRef.current;
    const highPass = highPassRef.current;
    const lowPass = lowPassRef.current;
    if (!ctx || !windGain || !masterGain || !highPass || !lowPass) return;

    const intensity = Math.min(Math.max(windValue, 0), 4);
    const targetGain = soundEnabled ? 0.004 + intensity * 0.006 : 0.0001;
    const targetLowPass = 900 + intensity * 260;
    const targetHighPass = 90 + intensity * 55;
    const now = ctx.currentTime;

    windGain.gain.setTargetAtTime(targetGain, now, 0.35);
    masterGain.gain.setTargetAtTime(soundEnabled ? 1 : 0.0001, now, 0.35);
    lowPass.frequency.setTargetAtTime(targetLowPass, now, 0.4);
    highPass.frequency.setTargetAtTime(targetHighPass, now, 0.4);
  };

  const initWindAudio = () => {
    if (audioContextRef.current) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;
    noiseSource.loop = true;

    const highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 120;

    const lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 1200;

    const windGain = ctx.createGain();
    windGain.gain.value = 0.0001;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.0001;

    const birdGain = ctx.createGain();
    birdGain.gain.value = 0.8;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09;

    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.004;

    noiseSource.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(windGain);
    windGain.connect(masterGain);
    birdGain.connect(masterGain);
    masterGain.connect(ctx.destination);

    lfo.connect(lfoDepth);
    lfoDepth.connect(windGain.gain);

    noiseSource.start();
    lfo.start();

    audioContextRef.current = ctx;
    windGainRef.current = windGain;
    masterGainRef.current = masterGain;
    highPassRef.current = highPass;
    lowPassRef.current = lowPass;
    noiseSourceRef.current = noiseSource;
    lfoRef.current = lfo;
    lfoDepthRef.current = lfoDepth;
    birdGainRef.current = birdGain;
  };

  const teardownWindAudio = () => {
    clearBirdTimer();
    if (suspendTimeoutRef.current) {
      window.clearTimeout(suspendTimeoutRef.current);
      suspendTimeoutRef.current = null;
    }
    const source = noiseSourceRef.current;
    const lfo = lfoRef.current;
    const ctx = audioContextRef.current;
    if (source) source.stop();
    if (lfo) lfo.stop();
    if (ctx) ctx.close();

    audioContextRef.current = null;
    windGainRef.current = null;
    masterGainRef.current = null;
    highPassRef.current = null;
    lowPassRef.current = null;
    birdGainRef.current = null;
    noiseSourceRef.current = null;
    lfoRef.current = null;
    lfoDepthRef.current = null;
  };

  const handleSoundToggle = async () => {
    const next = !isSoundOn;
    if (next) {
      initWindAudio();
      const ctx = audioContextRef.current;
      if (!ctx) return;
      if (suspendTimeoutRef.current) {
        window.clearTimeout(suspendTimeoutRef.current);
        suspendTimeoutRef.current = null;
      }
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      updateWindAudio(windRef.current, true);
      scheduleBirds();
    } else {
      const ctx = audioContextRef.current;
      if (ctx) {
        updateWindAudio(windRef.current, false);
        clearBirdTimer();
        suspendTimeoutRef.current = window.setTimeout(() => {
          if (ctx.state === 'running') {
            ctx.suspend();
          }
        }, 450);
      }
    }
    setIsSoundOn(next);
  };

  // Sync refs for the animation loop
  useEffect(() => {
    windRef.current = wind;
  }, [wind]);

  useEffect(() => {
    isNightRef.current = isNight;
  }, [isNight]);

  useEffect(() => {
    isSoundOnRef.current = isSoundOn;
  }, [isSoundOn]);

  useEffect(() => {
    if (!audioContextRef.current) return;
    updateWindAudio(wind, isSoundOn);
  }, [wind, isSoundOn]);

  useEffect(() => {
    if (!audioContextRef.current || !isSoundOn) return;
    scheduleBirds();
  }, [sunAngle, isNight, wind, isSoundOn]);

  // Handle Day/Night transition colors
  useEffect(() => {
    if (!sceneRef.current || !sunLightRef.current || !ambientLightRef.current) return;

    if (isNight) {
      sceneRef.current.background = new THREE.Color('#0a0b1e'); // Deep midnight blue
      sunLightRef.current.color.set('#aaccff'); // Cool moonlight
      sunLightRef.current.intensity = 1.2;
      ambientLightRef.current.intensity = 0.2;
    } else {
      sceneRef.current.background = new THREE.Color('#fcfbf9'); // Crisp daylight
      sunLightRef.current.color.set('#ffffff'); // Pure sunlight
      sunLightRef.current.intensity = 2.2;
      ambientLightRef.current.intensity = 0.65;
    }
  }, [isNight]);

  // Handle the Sun/Moon height arc and shadow direction mirroring
  useEffect(() => {
    sunAngleRef.current = sunAngle;
    if (sunLightRef.current) {
      const x = Math.cos(sunAngle * Math.PI) * 20;
      const y = Math.sin(sunAngle * Math.PI) * 28 + 12;
      const z = 0;
      
      sunLightRef.current.position.set(x, y, z);
      sunLightRef.current.lookAt(0, 2, 0); 
    }
  }, [sunAngle]);

  useEffect(() => {
    if (!containerRef.current) return;

    // --- SCENE SETUP ---
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#fcfbf9');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 1000);
    camera.position.set(22, 16, 22);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
    containerRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 4.5, 0);

    // --- LIGHTING ---
    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambient);
    ambientLightRef.current = ambient;
    
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunLight.castShadow = true;
    
    sunLight.shadow.camera.left = -35;
    sunLight.shadow.camera.right = 35;
    sunLight.shadow.camera.top = 35;
    sunLight.shadow.camera.bottom = -35;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 120;
    
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.radius = 8;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);
    sunLightRef.current = sunLight;

    // --- GEOMETRY ---
    const createLeafShape = () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.5, 0.2, 0.5, 0.8, 0, 1.2); 
      shape.bezierCurveTo(-0.5, 0.8, -0.5, 0.2, 0, 0);
      return new THREE.ShapeGeometry(shape);
    };

    const createBractShape = () => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.4, 0.1, 0.5, 0.6, 0, 1.0);
      shape.bezierCurveTo(-0.5, 0.6, -0.4, 0.1, 0, 0);
      return new THREE.ShapeGeometry(shape);
    };

    const leafGeo = createLeafShape();
    const bractGeo = createBractShape();
    const centerFlowerGeo = new THREE.CylinderGeometry(0.04, 0.02, 0.4, 6);
    centerFlowerGeo.translate(0, 0.2, 0);

    // --- MATERIALS ---
    const branchMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x3d7a21, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.98,
      alphaTest: 0.5
    });
    const bractMat = new THREE.MeshStandardMaterial({
      color: 0xc41e5e, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      alphaTest: 0.5
    });
    const centerFlowerMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, roughness: 1 });

    // --- PLANT DATA ---
    const leavesData = [];
    const bractsData = [];
    const centersData = [];
    
    const plantGroup = new THREE.Group();
    plantGroup.position.set(0, -1, 0);
    scene.add(plantGroup);

    const generateBougainvillea = () => {
      const iterations = 5;
      const angleSpread = (Math.PI / 180) * 35;
      const lengthScale = 0.76;
      const branchGeo = new THREE.CylinderGeometry(0.08, 0.12, 1, 8);
      branchGeo.translate(0, 0.5, 0);

      const grow = (pos, dir, depth) => {
        const len = Math.pow(lengthScale, 5 - depth) * 3.2;
        const endPos = pos.clone().add(dir.clone().multiplyScalar(len));
        
        const branchMesh = new THREE.Mesh(branchGeo, branchMat);
        branchMesh.position.copy(pos);
        branchMesh.scale.set(depth * 0.2, len, depth * 0.2);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        branchMesh.quaternion.copy(quaternion);
        branchMesh.castShadow = true;
        branchMesh.receiveShadow = true;
        plantGroup.add(branchMesh);

        if (depth <= 3) {
          const leafCount = depth === 1 ? 10 : 4;
          for (let i = 0; i < leafCount; i++) {
            leavesData.push({
              position: endPos.clone().add(new THREE.Vector3((Math.random()-0.5)*0.8, (Math.random()-0.5)*0.8, (Math.random()-0.5)*0.8)),
              rotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI),
              scale: Math.random()*0.3+0.6,
              jitter: Math.random() * 100,
              speed: 0.4 + Math.random() * 0.2 
            });
          }

          if (depth <= 2) {
            const clusterCount = depth === 1 ? 8 : 3;
            for (let c = 0; c < clusterCount; c++) {
              const clusterPos = endPos.clone().add(new THREE.Vector3((Math.random()-0.5)*1.8, (Math.random()-0.5)*1.8, (Math.random()-0.5)*1.8));
              const clusterRot = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
              const jitter = Math.random() * 100;
              const speed = 1.3 + Math.random() * 0.5;

              for (let i = 0; i < 3; i++) {
                const bractDummy = new THREE.Object3D();
                bractDummy.position.copy(clusterPos);
                bractDummy.rotation.copy(clusterRot);
                bractDummy.rotateY((i * Math.PI * 2) / 3);
                bractDummy.rotateX(0.5); 
                bractsData.push({ 
                  pos: bractDummy.position.clone(), 
                  rot: bractDummy.rotation.clone(), 
                  scale: 0.6 + Math.random() * 0.2, 
                  jitter, 
                  speed 
                });
              }
              centersData.push({ pos: clusterPos.clone(), rot: clusterRot.clone(), scale: 0.5, jitter, speed });
            }
          }
        }
        if (depth > 0) {
          const branches = depth === iterations ? 5 : 2;
          for (let i = 0; i < branches; i++) {
            const newDir = dir.clone();
            newDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random()-0.5)*angleSpread*2.2);
            newDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.random()*Math.PI * 2);
            newDir.normalize();
            grow(endPos, newDir, depth - 1);
          }
        }
      };

      for (let i = 0; i < 4; i++) {
        grow(new THREE.Vector3((Math.random()-0.5)*0.5, 0, (Math.random()-0.5)*0.5), 
             new THREE.Vector3((Math.random()-0.5)*0.2, 1, (Math.random()-0.5)*0.2).normalize(), 
             iterations);
      }
    };

    generateBougainvillea();

    const iLeaves = new THREE.InstancedMesh(leafGeo, leafMat, leavesData.length);
    iLeaves.castShadow = true;
    plantGroup.add(iLeaves);

    const iBracts = new THREE.InstancedMesh(bractGeo, bractMat, bractsData.length);
    iBracts.castShadow = true;
    plantGroup.add(iBracts);

    const iCenters = new THREE.InstancedMesh(centerFlowerGeo, centerFlowerMat, centersData.length);
    iCenters.castShadow = true;
    plantGroup.add(iCenters);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1; 
    floor.receiveShadow = true;
    scene.add(floor);

    // --- ANIMATION LOOP ---
    let frameId;
    const clock = new THREE.Clock();
    const dummy = new THREE.Object3D();

    const animate = () => {
      const t = clock.getElapsedTime();
      const w = windRef.current;
      
      plantGroup.rotation.x = Math.sin(t * 0.3) * 0.02 * w;
      plantGroup.rotation.z = Math.cos(t * 0.25) * 0.02 * w;

      for (let i = 0; i < leavesData.length; i++) {
        const data = leavesData[i];
        dummy.position.copy(data.position);
        dummy.rotation.set(
          data.rotation.x + Math.sin(t * data.speed + data.jitter) * 0.04 * w,
          data.rotation.y + Math.cos(t * data.speed * 0.8 + data.jitter) * 0.06 * w,
          data.rotation.z + Math.sin(t * data.speed * 1.2 + data.jitter) * 0.03 * w
        );
        dummy.scale.setScalar(data.scale);
        dummy.updateMatrix();
        iLeaves.setMatrixAt(i, dummy.matrix);
      }
      iLeaves.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < bractsData.length; i++) {
        const data = bractsData[i];
        dummy.position.copy(data.pos);
        dummy.rotation.copy(data.rot);
        dummy.rotateX(Math.sin(t * data.speed * 2.2 + data.jitter) * 0.15 * w);
        dummy.rotateY(Math.cos(t * data.speed * 2.8 + data.jitter) * 0.2 * w);
        dummy.scale.setScalar(data.scale);
        dummy.updateMatrix();
        iBracts.setMatrixAt(i, dummy.matrix);
      }
      iBracts.instanceMatrix.needsUpdate = true;

      for (let i = 0; i < centersData.length; i++) {
        const data = centersData[i];
        dummy.position.copy(data.pos);
        dummy.rotation.copy(data.rot);
        dummy.scale.setScalar(data.scale);
        dummy.updateMatrix();
        iCenters.setMatrixAt(i, dummy.matrix);
      }
      iCenters.instanceMatrix.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
      teardownWindAudio();
      if (containerRef.current) containerRef.current.innerHTML = '';
      renderer.dispose();
      leafGeo.dispose();
      bractGeo.dispose();
      centerFlowerGeo.dispose();
    };
  }, []);

  const celestialColor = isNight ? '#e0e0e0' : '#ff4500';

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: isNight ? '#0a0b1e' : '#fcfbf9', position: 'relative', overflow: 'hidden', transition: 'background-color 1.2s ease' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      <div style={{
        position: 'absolute', top: '40px', left: '40px', zIndex: 10,
        opacity: showUI ? 1 : 0, transition: 'opacity 0.6s ease', pointerEvents: showUI ? 'auto' : 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <h1 style={{ fontWeight: 200, fontSize: '2.2rem', margin: 0, color: isNight ? '#fff' : '#111', letterSpacing: '-0.02em', transition: 'color 1.2s' }}>Dappled Light</h1>
        <div style={{ height: '1px', width: '30px', backgroundColor: isNight ? '#fff' : '#000', opacity: 0.1, margin: '15px 0' }} />
        
        <div style={{ 
          background: isNight ? 'rgba(20, 25, 50, 0.4)' : 'rgba(255, 255, 255, 0.4)', backdropFilter: 'blur(15px)', padding: '24px', 
          borderRadius: '24px', border: `1px solid ${isNight ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.5)'}`, 
          boxShadow: '0 8px 30px rgba(0,0,0,0.03)', width: '220px',
          display: 'flex', flexDirection: 'column', gap: '24px'
        }}>
          {/* Mode Toggle */}
          <div>
            <div style={{ fontSize: '9px', fontWeight: 800, color: isNight ? '#778' : '#aaa', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Environment Mode
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setIsNight(false)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: '12px', border: 'none',
                  background: !isNight ? '#111' : 'rgba(255,255,255,0.05)',
                  color: !isNight ? '#fff' : '#778',
                  fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.4s'
                }}
              >
                Day
              </button>
              <button
                onClick={() => setIsNight(true)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: '12px', border: 'none',
                  background: isNight ? '#fff' : 'rgba(0,0,0,0.05)',
                  color: isNight ? '#111' : '#aaa',
                  fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.4s'
                }}
              >
                Night
              </button>
            </div>
          </div>

          {/* Wind UI */}
          <div>
            <div style={{ fontSize: '9px', fontWeight: 800, color: isNight ? '#778' : '#aaa', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Wind Motion
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[{ l: 'Slow', v: 0.5 }, { l: 'Med', v: 1.5 }, { l: 'Fast', v: 3.5 }].map((s) => (
                <button
                  key={s.l} onClick={() => setWind(s.v)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: '12px', border: 'none',
                    background: wind === s.v ? (isNight ? '#fff' : '#111') : 'rgba(128,128,128,0.1)',
                    color: wind === s.v ? (isNight ? '#000' : '#fff') : (isNight ? '#778' : '#666'),
                    fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s ease', outline: 'none'
                  }}
                >
                  {s.l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '9px', fontWeight: 800, color: isNight ? '#778' : '#aaa', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Ambient Sound
            </div>
            <button
              onClick={handleSoundToggle}
              style={{
                width: '100%',
                padding: '10px 0',
                borderRadius: '12px',
                border: 'none',
                background: isSoundOn ? (isNight ? '#fff' : '#111') : 'rgba(128,128,128,0.1)',
                color: isSoundOn ? (isNight ? '#000' : '#fff') : (isNight ? '#778' : '#666'),
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                outline: 'none'
              }}
            >
              {isSoundOn ? 'On' : 'Off'}
            </button>
          </div>

          {/* Compass Pointer */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
              <div style={{ fontSize: '9px', fontWeight: 800, color: isNight ? '#778' : '#aaa', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {isNight ? 'Moon' : 'Sun'} Direction
              </div>
              
              <div style={{ 
                width: '40px', height: '40px', borderRadius: '50%', border: `1px solid ${isNight ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`, 
                position: 'relative', background: isNight ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.5)'
              }}>
                <span style={{ position: 'absolute', top: '2px', left: '50%', transform: 'translateX(-50%)', fontSize: '6px', fontWeight: 'bold', color: isNight ? '#445' : '#bbb' }}>N</span>
                <span style={{ position: 'absolute', bottom: '2px', left: '50%', transform: 'translateX(-50%)', fontSize: '6px', fontWeight: 'bold', color: isNight ? '#445' : '#bbb' }}>S</span>
                <span style={{ position: 'absolute', left: '2px', top: '50%', transform: 'translateY(-50%)', fontSize: '6px', fontWeight: 'bold', color: '#bbb' }}>W</span>
                <span style={{ position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)', fontSize: '6px', fontWeight: 'bold', color: '#bbb' }}>E</span>
                
                <div style={{ 
                  position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%', 
                  transition: 'transform 0.1s linear',
                  transform: `translate(-50%, -50%) rotate(${sunAngle * 180 + 90}deg)`,
                }}>
                  <div style={{ 
                    position: 'absolute', top: '50%', left: '50%', 
                    width: '0', height: '0',
                    borderLeft: '3px solid transparent',
                    borderRight: '3px solid transparent',
                    borderBottom: `14px solid ${celestialColor}`,
                    transform: 'translate(-50%, -100%)',
                  }} />
                  <div style={{ 
                    position: 'absolute', top: '50%', left: '50%', 
                    width: '4px', height: '4px', borderRadius: '50%', 
                    background: '#fff', border: '1px solid rgba(0,0,0,0.1)',
                    transform: 'translate(-50%, -50%)', zIndex: 2
                  }} />
                </div>
              </div>
            </div>

            <input 
              type="range" min="0" max="1" step="0.01" 
              value={sunAngle} 
              onChange={(e) => setSunAngle(parseFloat(e.target.value))}
              className="celestial-slider"
              style={{ 
                width: '100%', cursor: 'pointer', height: '4px',
                backgroundColor: isNight ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderRadius: '2px', appearance: 'none'
              }}
            />
          </div>
        </div>
      </div>

      <button onClick={() => setShowUI(!showUI)} style={{
        position: 'absolute', bottom: '40px', left: '40px', zIndex: 10, border: 'none', background: 'none',
        color: isNight ? '#445' : '#aaa', fontSize: '8px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.2em', cursor: 'pointer'
      }}>
        {showUI ? '[ Hide Interface ]' : '[ Show Interface ]'}
      </button>

      <style>{`
        body { margin: 0; padding: 0; }
        button:hover { transform: translateY(-1px); }
        
        .celestial-slider::-webkit-slider-thumb {
          appearance: none;
          height: 18px;
          width: 18px;
          border-radius: 50%;
          background: ${celestialColor};
          cursor: pointer;
          border: none;
          box-shadow: 0 0 10px ${isNight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 69, 0, 0.4)'};
          transition: transform 0.1s ease-in-out, background 0.4s;
        }
        
        .celestial-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
      `}</style>
    </div>
  );
};

export default App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
