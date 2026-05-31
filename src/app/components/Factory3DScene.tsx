'use client';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Line } from '@react-three/drei';
import { useRef, useMemo, useState, useCallback } from 'react';
import * as THREE from 'three';

interface CompanyNode {
  id: string;
  name: string;
  type: string;
  health: number;
  agents: number;
}

interface Props {
  companies: CompanyNode[];
  onSelectCompany: (id: string) => void;
}

const TYPE_COLOR: Record<string, string> = {
  trading: '#00c896',
  cinematography: '#f0b429',
  marketing: '#4f8ef7',
};

const PARTICLE_COUNT = 300;

function getNodePositions(count: number, radius = 7): [number, number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius];
  });
}

function GridFloor() {
  return <gridHelper args={[40, 40, '#1e2433', '#161b22']} position={[0, -0.01, 0]} />;
}

function TimeRiver() {
  const points = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-18, 0.05, 2),
      new THREE.Vector3(-12, 0.05, -1),
      new THREE.Vector3(-6, 0.05, 1),
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Vector3(6, 0.05, -1),
      new THREE.Vector3(12, 0.05, 1),
      new THREE.Vector3(18, 0.05, -2),
    ]);
    return curve.getPoints(80);
  }, []);

  return (
    <>
      <Line points={points} color="#00c896" lineWidth={1.5} opacity={0.35} transparent />
      {([[-18, 0.3, 2, 'PASADO'], [0, 0.3, 0, 'PRESENTE'], [18, 0.3, -2, 'FUTURO']] as [number, number, number, string][]).map(([x, y, z, label]) => (
        <Text key={label} position={[x, y, z]} fontSize={0.35} color="#8b949e" anchorX="center" anchorY="middle">
          {label}
        </Text>
      ))}
    </>
  );
}

function DataParticles({ nodePositions }: { nodePositions: [number, number, number][] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    const n = nodePositions.length;
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const src = i % n;
      const dst = (src + 1 + Math.floor(Math.random() * (n - 1))) % n;
      return { t: Math.random(), speed: 0.003 + Math.random() * 0.005, src, dst, yArc: 0.5 + Math.random() * 2 };
    });
  }, [nodePositions]);

  useFrame(() => {
    if (!meshRef.current || nodePositions.length < 2) return;
    particles.forEach((p, i) => {
      p.t += p.speed;
      if (p.t > 1) {
        p.t = 0;
        p.src = p.dst;
        p.dst = (p.dst + 1 + Math.floor(Math.random() * (nodePositions.length - 1))) % nodePositions.length;
      }
      const [sx, , sz] = nodePositions[p.src];
      const [dx, , dz] = nodePositions[p.dst];
      const t = p.t;
      const mx = (sx + dx) / 2, my = p.yArc, mz = (sz + dz) / 2;
      const x = (1-t)*(1-t)*sx + 2*(1-t)*t*mx + t*t*dx;
      const y = (1-t)*(1-t)*0 + 2*(1-t)*t*my + t*t*0;
      const z = (1-t)*(1-t)*sz + 2*(1-t)*t*mz + t*t*dz;
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(0.07);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <sphereGeometry args={[1, 4, 4]} />
      <meshBasicMaterial color="#00c896" transparent opacity={0.7} />
    </instancedMesh>
  );
}

function CompanyNodeMesh({ company, position, onSelect }: { company: CompanyNode; position: [number, number, number]; onSelect: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const [hovered, setHovered] = useState(false);
  const color = TYPE_COLOR[company.type] ?? '#a78bfa';
  const healthY = company.health * 3;
  const finalPos: [number, number, number] = [position[0], healthY * 0.5, position[2]];

  const material = useMemo(() => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: hovered ? 1.2 : 0.4, metalness: 0.8, roughness: 0.15,
  }), [color, hovered]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * 0.6;
    if (ringRef.current) ringRef.current.rotation.z += delta * 0.4;
    const s = hovered ? 1.3 : 1;
    meshRef.current.scale.lerp(new THREE.Vector3(s, s, s), 0.1);
  });

  return (
    <group position={finalPos}>
      <mesh ref={meshRef} material={material}
        onPointerOver={() => { setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
        onClick={onSelect}>
        <octahedronGeometry args={[0.6, 0]} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1, 0.04, 8, 32]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={hovered ? 0.8 : 0.2} transparent opacity={0.6} />
      </mesh>
      <Line points={[[0,0,0],[0,-healthY*0.5-0.05,0]]} color={color} lineWidth={1} opacity={0.25} transparent />
      <Text position={[0, 1.4, 0]} fontSize={0.28} color={hovered ? '#fff' : '#e6edf3'} anchorX="center" anchorY="middle" outlineWidth={0.02} outlineColor="#010409">
        {company.name}
      </Text>
      <Text position={[0, 1.05, 0]} fontSize={0.18} color="#8b949e" anchorX="center" anchorY="middle">
        {company.type.toUpperCase()} · {company.agents} agentes
      </Text>
      <pointLight color={color} intensity={hovered ? 3 : 1.2} distance={4} decay={2} />
    </group>
  );
}

function SceneContent({ companies, onSelectCompany }: Props) {
  const positions = useMemo(() => getNodePositions(companies.length), [companies.length]);
  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight position={[10, 20, 10]} intensity={0.4} color="#e6edf3" />
      <pointLight position={[-15, 5, 0]} color="#00c896" intensity={2} distance={20} />
      <pointLight position={[15, 5, 0]} color="#4f8ef7" intensity={2} distance={20} />
      <pointLight position={[0, 5, 15]} color="#f0b429" intensity={1.5} distance={18} />
      <GridFloor />
      <TimeRiver />
      {companies.map((company, i) => (
        <CompanyNodeMesh key={company.id} company={company} position={positions[i]} onSelect={() => onSelectCompany(company.id)} />
      ))}
      <DataParticles nodePositions={positions} />
      <OrbitControls enablePan enableZoom enableRotate minDistance={5} maxDistance={35} maxPolarAngle={Math.PI / 2.1} dampingFactor={0.05} enableDamping />
    </>
  );
}

export default function Factory3DScene({ companies, onSelectCompany }: Props) {
  return (
    <Canvas camera={{ position: [0, 12, 18], fov: 55 }} dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ background: '#010409' }}>
      <fog attach="fog" args={['#010409', 20, 45]} />
      <SceneContent companies={companies} onSelectCompany={onSelectCompany} />
    </Canvas>
  );
}