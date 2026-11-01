"""Проверка перед контрольной: OpenCV, камера и коды клавиш.

Запуск:  python check_camera.py
Нажимайте любые клавиши в окне с видео — в консоли появится их код.
q — выход.
"""
import cv2

print("OpenCV", cv2.__version__)
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)   # запасной способ для Windows
if not cap.isOpened():
    raise SystemExit("❌ Камера не открылась. Закройте Zoom/Teams/браузер с камерой или попробуйте VideoCapture(1).")

ok, frame = cap.read()
print("✅ Камера работает, кадр:", frame.shape if ok else "не прочитан")
print("Нажимайте клавиши в окне видео. q — выход.")

while True:
    ok, frame = cap.read()
    if not ok:
        break
    cv2.putText(frame, "press keys, q = quit", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
    cv2.imshow("check", frame)
    key = cv2.waitKey(1) & 0xFF
    if key != 255:
        print(f"клавиша {chr(key)!r}: код {key}")
    if key == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
