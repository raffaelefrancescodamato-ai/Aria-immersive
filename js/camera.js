/**
 * Camera Controller
 * Supports dynamic targets, OrbitControls integration, and cinematic transitions.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getARIAPosition } from './aria.js';
import { getProductPosition, activateProductSpotlight, getProductBounds } from './product.js';

const CAMERA_POSITIONS = {
    start: {
        position: new THREE.Vector3(0, 1.5, 6),
        lookAt: new THREE.Vector3(0, 1, 0),
        fov: 50
    }
};

export class CameraController {
    constructor(camera, renderer) {
        this.camera = camera;
        this.renderer = renderer;
        this.currentTarget = new THREE.Vector3(0, 1, 0);
        this.isTransitioning = false;
        this.isFollowingARIA = false;
        this.isOrbiting = false;
        this.isTouring = false;
        this.tourPath = null;
        this.tourLookPath = null;
        this.tourTime = 0;
        this.tourDuration = 18;
        this.tourLoop = true;
        this.tourBlend = 0.08;
        this.onTourComplete = null;
        this.transitionResolve = null;
        this.transitionTween = null;
        this.lastAriaPos = new THREE.Vector3();
        this.ariaVelocity = new THREE.Vector3();
        this.orbitTarget = new THREE.Vector3();

        // Orbit Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enabled = false;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.minDistance = 2.2;
        this.controls.maxDistance = 7;
        this.controls.enablePan = false;
        this.controls.screenSpacePanning = false;
        this.controls.rotateSpeed = 0.7;
        this.controls.zoomSpeed = 0.8;
        this.controls.minPolarAngle = Math.PI / 6;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.08;

        this.camera.position.copy(CAMERA_POSITIONS.start.position);
        this.camera.lookAt(CAMERA_POSITIONS.start.lookAt);
    }

    followARIA(active) {
        if (this.isOrbiting) return;
        this.isFollowingARIA = active;
        if (active) {
            const ariaPos = getARIAPosition();
            this.lastAriaPos.copy(ariaPos);
            this.ariaVelocity.set(0, 0, 0);
        }
    }

    enableOrbitMode(targetPosition, options = {}) {
        this.isOrbiting = true;
        this.isFollowingARIA = false;
        this.isTransitioning = false;

        this.controls.enabled = true;
        this.orbitTarget.copy(targetPosition);
        this.controls.target.copy(this.orbitTarget);

        const radius = Number.isFinite(options.radius) ? options.radius : 2.8;
        const minDistance = options.minDistance ?? Math.max(1.3, radius + 0.25);
        const maxDistance = options.maxDistance ?? Math.max(minDistance + 4.5, radius + 8);
        this.controls.minDistance = minDistance;
        this.controls.maxDistance = maxDistance;

        const offset = this.camera.position.clone().sub(this.orbitTarget);
        const length = Math.max(offset.length(), 0.001);
        const polarAngle = Math.acos(THREE.MathUtils.clamp(offset.y / length, -1, 1));
        const range = options.polarRange ?? 0.16;
        this.controls.minPolarAngle = Math.max(0.45, polarAngle - range);
        this.controls.maxPolarAngle = Math.min(Math.PI / 2 - 0.08, polarAngle + range);

        this.controls.update();
    }

    disableOrbitMode() {
        this.isOrbiting = false;
        this.controls.enabled = false;
        this.currentTarget.copy(this.controls.target);
    }

    cancelTransition() {
        if (typeof gsap !== 'undefined') {
            gsap.killTweensOf(this.camera.position);
            gsap.killTweensOf(this.currentTarget);
            if (this.transitionTween) {
                this.transitionTween.kill();
            }
        }
        this.transitionTween = null;
        if (this.transitionResolve) {
            const done = this.transitionResolve;
            this.transitionResolve = null;
            this.isTransitioning = false;
            done();
        }
    }

    startTour(pathPoints, lookPoints, options = {}) {
        if (this.isOrbiting) this.disableOrbitMode();
        this.cancelTransition();

        this.isTouring = true;
        this.isFollowingARIA = false;
        this.isTransitioning = false;
        this.controls.enabled = false;

        this.tourLoop = options.loop ?? true;
        this.tourPath = new THREE.CatmullRomCurve3(pathPoints, this.tourLoop, 'centripetal', 0.6);
        this.tourLookPath = new THREE.CatmullRomCurve3(lookPoints, this.tourLoop, 'centripetal', 0.5);

        this.tourDuration = options.duration ?? 18;
        this.tourBlend = options.blend ?? 0.08;
        this.tourTime = 0;
        this.onTourComplete = this.tourLoop ? null : (options.onComplete || null);

        if (typeof gsap !== 'undefined') {
            gsap.killTweensOf(this.camera.position);
            gsap.killTweensOf(this.currentTarget);
        }
    }

    stopTour() {
        if (!this.isTouring) return;
        this.isTouring = false;
        if (this.onTourComplete) {
            const done = this.onTourComplete;
            this.onTourComplete = null;
            done();
        }
    }

    playTour(pathPoints, lookPoints, options = {}) {
        return new Promise((resolve) => {
            const onComplete = () => {
                if (typeof options.onComplete === 'function') {
                    options.onComplete();
                }
                resolve();
            };

            this.startTour(pathPoints, lookPoints, {
                ...options,
                loop: options.loop ?? false,
                onComplete
            });
        });
    }

    startShowroomTour(options = {}) {
        const start = this.camera.position.clone();
        const pathPoints = options.path || [
            start,
            new THREE.Vector3(3.6, 1.8, 5.1),
            new THREE.Vector3(5.2, 1.6, 1.5),
            new THREE.Vector3(2.2, 1.4, -2.8),
            new THREE.Vector3(-2.8, 1.5, -1.0),
            new THREE.Vector3(-3.6, 1.8, 3.8)
        ];

        const lookPoints = options.lookPath || [
            new THREE.Vector3(0, 1.1, -1.5),
            new THREE.Vector3(0.6, 1.05, -3.8),
            new THREE.Vector3(0.2, 1.0, -5.2),
            new THREE.Vector3(-0.8, 1.05, -4.2),
            new THREE.Vector3(0, 1.1, -2.0)
        ];

        this.startTour(pathPoints, lookPoints, options);
    }

    playProductCinematic(collectionName, options = {}) {
        const bounds = getProductBounds(collectionName);
        const target = bounds ? bounds.center.clone() : getProductPosition(collectionName).clone();
        target.y = Math.max(0.5, target.y);
        const baseRadius = bounds ? Math.max(3.4, bounds.radius + 1.4) : 4.8;
        let radius = options.radius ?? baseRadius;
        const height = options.height ?? (bounds ? Math.max(1.1, target.y + bounds.size.y * 0.24) : 1.5);
        const segments = options.segments ?? 7;
        const startAngle = Math.atan2(
            this.camera.position.z - target.z,
            this.camera.position.x - target.x
        );

        if (Math.abs(target.x) > 4) {
            radius = Math.max(baseRadius, Math.min(radius, 3.8));
        }

        const pathPoints = [this.camera.position.clone()];
        for (let i = 0; i <= segments; i++) {
            const angle = startAngle + (Math.PI * 2 * (i / segments));
            const lift = Math.sin(i / segments * Math.PI * 2) * 0.2;
            pathPoints.push(new THREE.Vector3(
                target.x + Math.cos(angle) * radius,
                height + lift,
                target.z + Math.sin(angle) * radius
            ));
        }

        const lookPoints = pathPoints.map((point, idx) => new THREE.Vector3(
            target.x + Math.sin(idx * 0.6) * 0.12,
            target.y + (bounds ? Math.min(1.0, bounds.size.y * 0.25) : 0.9),
            target.z + Math.cos(idx * 0.5) * 0.12
        ));

        return this.playTour(pathPoints, lookPoints, {
            duration: options.duration ?? 12,
            blend: options.blend ?? 0.1,
            loop: false
        });
    }

    frameAriaAndProduct(collectionName, options = {}) {
        const ariaPos = getARIAPosition();
        const bounds = getProductBounds(collectionName);
        const productPos = bounds ? bounds.center.clone() : getProductPosition(collectionName);
        productPos.y = Math.max(0.5, productPos.y);
        const mid = ariaPos.clone().lerp(productPos, 0.5);

        const spacing = ariaPos.distanceTo(productPos);
        const radius = bounds ? bounds.radius : 2.8;
        const distance = options.distance ?? Math.max(5.4, spacing + radius + 3.2);
        const sideBias = ariaPos.x - productPos.x;
        const sideShift = THREE.MathUtils.clamp(-sideBias * 0.6, -1.4, 1.4);
        const camPos = new THREE.Vector3(
            mid.x + sideShift,
            mid.y,
            mid.z + distance
        );
        camPos.y = options.height ?? Math.max(1.2, mid.y + 1.15);

        const lookAt = mid.clone();
        const lift = bounds ? Math.min(1.1, Math.max(0.7, bounds.size.y * 0.22)) : 0.85;
        lookAt.y += options.lookLift ?? lift;

        return this.transitionTo('custom', options.duration ?? 1.4, camPos, lookAt);
    }

    stopShowroomTour() {
        this.isTouring = false;
        this.onTourComplete = null;
    }

    transitionTo(type, duration = 2, arg1 = null, arg2 = null) {
        if (this.isOrbiting) this.disableOrbitMode();
        this.isTouring = false;
        this.onTourComplete = null;
        this.cancelTransition();

        return new Promise((resolve) => {
            let finalPosition = new THREE.Vector3();
            let finalLookAt = new THREE.Vector3();
            const startPosition = this.camera.position.clone();
            const startLookAt = this.currentTarget.clone();
            const finish = () => {
                if (!this.transitionResolve) return;
                this.transitionResolve = null;
                this.isTransitioning = false;
                this.transitionTween = null;
                resolve();
            };

            this.isTransitioning = true;
            this.isFollowingARIA = false;
            this.transitionResolve = finish;

            if (type === 'start') {
                finalPosition.copy(CAMERA_POSITIONS.start.position);
                finalLookAt.copy(CAMERA_POSITIONS.start.lookAt);
            }
            else if (type === 'product_with_aria') {
                const collectionName = arg1 || 'elegance';
                const bounds = getProductBounds(collectionName);
                const productPos = bounds ? bounds.center.clone() : getProductPosition(collectionName);
                productPos.y = Math.max(0.5, productPos.y);
                const radius = bounds ? bounds.radius : 2.8;

                // Cinematic "Heroic" Angle
                finalLookAt = productPos.clone();
                const lookLift = bounds ? Math.min(1.0, Math.max(0.5, bounds.size.y * 0.22)) : 0.8;
                finalLookAt.y += lookLift;

                const distance = Math.max(4.6, radius + 3.2);
                finalPosition.set(productPos.x, Math.max(1.0, productPos.y + 0.6), productPos.z + distance);

                const sideShift = bounds ? Math.min(1.6, Math.max(0.8, radius * 0.35)) : 1.5;
                if (collectionName === 'elegance') {
                    finalPosition.x += sideShift;
                } else if (collectionName === 'luxury') {
                    finalPosition.x -= sideShift;
                }

                activateProductSpotlight(true, collectionName);
            }
            else if (type === 'custom') {
                // arg1 is position, arg2 is lookAt
                if (arg1) finalPosition.copy(arg1);
                if (arg2) finalLookAt.copy(arg2);
            }
            else if (type === 'return_start') {
                // Pos: (0, 0.5, 3.5) [User Preferred]
                finalPosition.set(0, 0.5, 3.5);
                // LookAt will be dynamically calculated below
            }

            if (typeof gsap !== 'undefined') {
                if (type === 'return_start') {
                    this.transitionTween = gsap.to(this.camera.position, {
                        x: finalPosition.x, y: finalPosition.y, z: finalPosition.z,
                        duration: duration, ease: 'power2.inOut',
                        onUpdate: () => {
                            // For return_start, we activate SMART FOLLOW
                            // We track ARIA's horizontal position but ignore the vertical Bobbing
                            const ariaPos = getARIAPosition();
                            // Stabilized Target: ARIA's X/Z, Lower Height (0.6m - Waist/Legs)
                            // This points the camera downwards as requested
                            const stabilizedTarget = new THREE.Vector3(ariaPos.x, 0.6, ariaPos.z);

                            this.camera.lookAt(stabilizedTarget);
                            this.currentTarget.copy(stabilizedTarget);
                        }
                    });

                    setTimeout(finish, duration * 1000);
                } else {
                    const direction = new THREE.Vector3().subVectors(finalPosition, startPosition);
                    const distance = direction.length();
                    const side = new THREE.Vector3(-direction.z, 0, direction.x);
                    if (side.lengthSq() > 0) side.normalize();

                    const midPos = startPosition.clone().lerp(finalPosition, 0.5);
                    const arcOffset = Math.min(1.2, distance * 0.15);
                    const lift = Math.min(0.6, distance * 0.08);
                    midPos.addScaledVector(side, arcOffset);
                    midPos.y += lift;

                    const lookMid = startLookAt.clone().lerp(finalLookAt, 0.5);
                    lookMid.y += Math.min(0.4, distance * 0.05);

                    const posCurve = new THREE.CatmullRomCurve3([startPosition, midPos, finalPosition], false, 'centripetal', 0.5);
                    const lookCurve = new THREE.CatmullRomCurve3([startLookAt, lookMid, finalLookAt], false, 'centripetal', 0.5);

                    const tween = { t: 0 };
                    this.transitionTween = gsap.to(tween, {
                        t: 1,
                        duration: duration,
                        ease: 'sine.inOut',
                        onUpdate: () => {
                            const t = tween.t;
                            const camPos = posCurve.getPointAt(t);
                            const lookPos = lookCurve.getPointAt(t);

                            this.camera.position.copy(camPos);
                            this.currentTarget.copy(lookPos);
                            this.camera.lookAt(this.currentTarget);
                        },
                        onComplete: finish
                    });
                }
            } else {
                // Fallback if GSAP is not defined, immediately set position and lookAt
                this.camera.position.copy(finalPosition);
                this.camera.lookAt(finalLookAt);
                this.currentTarget.copy(finalLookAt);
                finish();
            }
        });
    }

    update(delta) {
        if (this.isOrbiting) {
            this.controls.target.copy(this.orbitTarget);
            this.controls.update();
            return;
        }

        if (this.isTouring) {
            if (!this.tourPath || !this.tourLookPath) return;

            this.tourTime += delta;
            const duration = Math.max(this.tourDuration, 0.1);
            const rawT = this.tourTime / duration;
            const t = this.tourLoop ? rawT % 1 : Math.min(rawT, 1);

            const tourPos = this.tourPath.getPointAt(t);
            const tourLook = this.tourLookPath.getPointAt(t);

            const blend = this.tourBlend;
            this.camera.position.lerp(tourPos, blend);
            this.currentTarget.lerp(tourLook, blend + 0.02);
            this.camera.lookAt(this.currentTarget);

            if (!this.tourLoop && rawT >= 1) {
                this.isTouring = false;
                if (this.onTourComplete) {
                    const done = this.onTourComplete;
                    this.onTourComplete = null;
                    done();
                }
            }
            return;
        }

        if (this.isFollowingARIA && !this.isTransitioning) {
            const ariaPos = getARIAPosition();
            const safeDelta = Math.max(delta, 0.001);
            const velocity = ariaPos.clone().sub(this.lastAriaPos).divideScalar(safeDelta);
            this.ariaVelocity.lerp(velocity, 0.12);
            this.lastAriaPos.copy(ariaPos);

            const lookAhead = this.ariaVelocity.clone().multiplyScalar(0.35);
            lookAhead.y = 0;

            const targetLook = ariaPos.clone().add(lookAhead);
            targetLook.y += 0.9;

            const targetCamPos = new THREE.Vector3(
                ariaPos.x + lookAhead.x * 0.4,
                ariaPos.y + 1.35,
                ariaPos.z + 4.2 + lookAhead.z * 0.4
            );

            const followEase = 1 - Math.exp(-delta * 3.5);
            this.camera.position.lerp(targetCamPos, followEase);
            this.currentTarget.lerp(targetLook, followEase);
            this.camera.lookAt(this.currentTarget);
        }
    }
}
