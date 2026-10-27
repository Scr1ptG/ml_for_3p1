"""Лица с веб-камеры — запуск на компьютере, не в Colab.

Установка (один раз):  pip install opencv-python
Запуск:                python faces_local.py

Клавиши (окно с видео должно быть активным):
  r — начать / закончить запись: в папку video пишутся только вырезанные лица (КТ 1)
  m — показывать все лица и счётчик «Faces: N» / только первое лицо (КТ 2)
  q — выход
"""
import os
import time

import cv2

FACE_SIZE = (200, 200)  # все кадры видео должны быть одного размера

face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
cap = cv2.VideoCapture(0)
if not cap.isOpened():
    raise SystemExit("Камера не открылась. Закройте другие программы, которые её используют (Zoom, Telegram, браузер).")

os.makedirs("video", exist_ok=True)
writer = None
show_all = True

while True:
    ok, frame = cap.read()
    if not ok:
        break
    frame = cv2.flip(frame, 1)  # как в зеркале
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(60, 60))

    if writer is not None and len(faces) > 0:
        x, y, w, h = faces[0]
        writer.write(cv2.resize(frame[y:y + h, x:x + w], FACE_SIZE))

    shown = faces if show_all else faces[:1]
    for (x, y, w, h) in shown:
        cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 3)
    if show_all:
        cv2.putText(frame, f"Faces: {len(faces)}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
    if writer is not None:
        cv2.circle(frame, (frame.shape[1] - 25, 25), 10, (0, 0, 255), -1)  # красная точка — идёт запись
    cv2.putText(frame, "r - zapis  m - vse/odno  q - vyhod", (10, frame.shape[0] - 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.imshow("Faces", frame)

    key = cv2.waitKey(1) & 0xFF
    if key == ord("q"):
        break
    if key == ord("m"):
        show_all = not show_all
    if key == ord("r"):
        if writer is None:
            name = time.strftime("video/faces_%H%M%S.mp4")
            writer = cv2.VideoWriter(name, cv2.VideoWriter_fourcc(*"mp4v"), 20, FACE_SIZE)
            print("Запись:", name)
        else:
            writer.release()
            writer = None
            print("Запись остановлена")

if writer is not None:
    writer.release()
cap.release()
cv2.destroyAllWindows()
