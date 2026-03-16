"""
Face Tracking Animation Flask Server
Provides real-time face tracking via webcam with animated avatar output
"""

from flask import Flask, render_template, request, jsonify, Response
from flask_cors import CORS
import cv2
import numpy as np
import mediapipe as mp
import json
import threading
import time
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Initialize MediaPipe Face Mesh
mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles

# Face mesh configuration
FACE_MESH_CONTOURS = mp_face_mesh.FACEMESH_TESSELATION
LEFT_IRIS = mp_face_mesh.FACEMESH_LEFT_IRIS
RIGHT_IRIS = mp_face_mesh.FACEMESH_RIGHT_IRIS

# Global state
camera = None
is_tracking = False
face_data = {
    "detected": False,
    "landmarks": [],
    "expressions": {
        "mouth_open": 0.0,
        "eyes_open": 1.0,
        "eyebrows_raised": 0.0,
        "head_rotation": {"x": 0, "y": 0, "z": 0}
    },
    "timestamp": 0
}

def init_camera():
    """Initialize webcam"""
    global camera
    try:
        camera = cv2.VideoCapture(0)
        camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        return camera.isOpened()
    except Exception as e:
        print(f"Camera init error: {e}")
        return False

def release_camera():
    """Release webcam"""
    global camera
    if camera:
        camera.release()
        camera = None

def calculate_expressions(landmarks, face_rect):
    """Calculate facial expressions from landmarks"""
    expressions = {
        "mouth_open": 0.0,
        "eyes_open": 1.0,
        "eyebrows_raised": 0.0,
        "head_rotation": {"x": 0, "y": 0, "z": 0}
    }
    
    if len(landmarks) < 468:
        return expressions
    
    # Mouth open detection (upper lip to lower lip distance)
    upper_lip = landmarks[13]  # Top of upper lip
    lower_lip = landmarks[14]  # Bottom of lower lip
    mouth_width = landmarks[61][0] - landmarks[291][0]  # Corner to corner
    mouth_height = abs(upper_lip[1] - lower_lip[1])
    
    if mouth_width > 0:
        expressions["mouth_open"] = min(1.0, mouth_height / (mouth_width * 0.3))
    
    # Eye open detection
    left_eye_top = landmarks[159]
    left_eye_bottom = landmarks[145]
    right_eye_top = landmarks[386]
    right_eye_bottom = landmarks[374]
    
    left_eye_open = abs(left_eye_top[1] - left_eye_bottom[1])
    right_eye_open = abs(right_eye_top[1] - right_eye_bottom[1])
    eye_width = abs(landmarks[33][0] - landmarks[133][0])
    
    if eye_width > 0:
        avg_eye_open = (left_eye_open + right_eye_open) / 2
        expressions["eyes_open"] = min(1.0, avg_eye_open / (eye_width * 0.15))
    
    # Eyebrow raise detection
    left_brow_top = landmarks[70]
    left_eye_center = landmarks[159]
    right_brow_top = landmarks[300]
    right_eye_center = landmarks[386]
    
    left_brow_raise = abs(left_brow_top[1] - left_eye_center[1])
    right_brow_raise = abs(right_brow_top[1] - right_eye_center[1])
    face_height = face_rect[3] if face_rect else 480
    
    if face_height > 0:
        avg_brow_raise = (left_brow_raise + right_brow_raise) / 2
        expressions["eyebrows_raised"] = min(1.0, (avg_brow_raise / face_height - 0.05) * 10)
    
    # Head rotation estimation (simplified)
    nose_tip = landmarks[1]
    nose_base = landmarks[4]
    
    if nose_tip and nose_base:
        expressions["head_rotation"]["x"] = (nose_tip[1] - nose_base[1]) * 10
        expressions["head_rotation"]["y"] = (nose_tip[0] - 0.5) * 20
        expressions["head_rotation"]["z"] = 0  # Would need more complex calculation
    
    return expressions

def track_faces():
    """Main face tracking loop"""
    global face_data, is_tracking, camera
    
    with mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5
    ) as face_mesh:
        
        while is_tracking:
            if not camera:
                time.sleep(0.1)
                continue
            
            ret, frame = camera.read()
            if not ret:
                time.sleep(0.1)
                continue
            
            # Convert to RGB for MediaPipe
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = face_mesh.process(rgb_frame)
            
            face_rect = None
            
            if results.multi_face_landmarks:
                for face_landmarks in results.multi_face_landmarks:
                    # Get landmarks as list
                    landmarks = []
                    h, w, _ = frame.shape
                    for lm in face_landmarks.landmark:
                        landmarks.append([lm.x, lm.y, lm.z])
                    
                    # Calculate face bounding box
                    x_coords = [lm[0] for lm in landmarks]
                    y_coords = [lm[1] for lm in landmarks]
                    face_rect = [
                        int(min(x_coords) * w),
                        int(min(y_coords) * h),
                        int((max(x_coords) - min(x_coords)) * w),
                        int((max(y_coords) - min(y_coords)) * h)
                    ]
                    
                    # Calculate expressions
                    expressions = calculate_expressions(landmarks, face_rect)
                    
                    # Update global face data
                    face_data = {
                        "detected": True,
                        "landmarks": landmarks,
                        "expressions": expressions,
                        "face_rect": face_rect,
                        "timestamp": time.time()
                    }
            else:
                face_data = {
                    "detected": False,
                    "landmarks": [],
                    "expressions": {
                        "mouth_open": 0.0,
                        "eyes_open": 1.0,
                        "eyebrows_raised": 0.0,
                        "head_rotation": {"x": 0, "y": 0, "z": 0}
                    },
                    "timestamp": time.time()
                }
            
            time.sleep(0.03)  # ~30 FPS

@app.route('/')
def index():
    """Serve the face tracking UI"""
    return render_template('face-tracking.html')

@app.route('/api/status')
def get_status():
    """Get current tracking status"""
    return jsonify({
        "tracking": is_tracking,
        "face_detected": face_data["detected"],
        "expressions": face_data["expressions"],
        "timestamp": face_data["timestamp"]
    })

@app.route('/api/start', methods=['POST'])
def start_tracking():
    """Start face tracking"""
    global is_tracking, camera
    
    if is_tracking:
        return jsonify({"status": "already_running"})
    
    if not camera:
        if not init_camera():
            return jsonify({"error": "Camera not available"}), 500
    
    is_tracking = True
    threading.Thread(target=track_faces, daemon=True).start()
    
    return jsonify({"status": "started"})

@app.route('/api/stop', methods=['POST'])
def stop_tracking():
    """Stop face tracking"""
    global is_tracking
    
    is_tracking = False
    time.sleep(0.2)  # Allow thread to stop
    
    return jsonify({"status": "stopped"})

@app.route('/api/camera', methods=['POST'])
def toggle_camera():
    """Toggle camera on/off"""
    global camera
    
    action = request.json.get('action', 'toggle')
    
    if action == 'on':
        if init_camera():
            return jsonify({"status": "camera_on"})
        return jsonify({"error": "Camera not available"}), 500
    elif action == 'off':
        release_camera()
        return jsonify({"status": "camera_off"})
    else:  # toggle
        if camera:
            release_camera()
            return jsonify({"status": "camera_off"})
        else:
            if init_camera():
                return jsonify({"status": "camera_on"})
            return jsonify({"error": "Camera not available"}), 500

@app.route('/api/expressions')
def get_expressions():
    """Get current facial expressions"""
    return jsonify(face_data["expressions"])

@app.route('/api/landmarks')
def get_landmarks():
    """Get current face landmarks"""
    return jsonify({
        "detected": face_data["detected"],
        "landmarks": face_data["landmarks"][:10] if face_data["landmarks"] else [],  # First 10 for performance
        "count": len(face_data["landmarks"])
    })

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "tracking": is_tracking,
        "timestamp": datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("🎭 Face Tracking Animation Server")
    print("Starting Flask server on http://localhost:5001")
    print("Press Ctrl+C to stop")
    
    try:
        app.run(host='0.0.0.0', port=5001, debug=False, threaded=True)
    except KeyboardInterrupt:
        print("\nShutting down...")
        is_tracking = False
        release_camera()
        print("Server stopped")
