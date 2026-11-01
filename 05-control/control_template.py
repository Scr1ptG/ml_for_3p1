"""Контрольная работа по работе с видео.

Фамилия Имя: ____________________     Вариант: ___

Задание 1. Клавиша s включает/выключает усиление канала на 10%
           (вариант 1 — красный, 2 — синий, 3 — зелёный).
Задание 2. Клавиша t включает/выключает поворот картинки на 180°.
q — выход.
"""
import cv2
import numpy as np

VARIANT = 1          # ← ваш вариант

cap = cv2.VideoCapture(0)
boost = False        # включено ли усиление канала
rotate = False       # включён ли поворот

while True:
    ok, frame = cap.read()
    if not ok:
        break

    if boost:
        pass         # TODO задание 1: усилить нужный канал на 10%

    if rotate:
        pass         # TODO задание 2: повернуть кадр на 180°

    cv2.imshow("control", frame)
    key = cv2.waitKey(1) & 0xFF

    # TODO: по клавише s переключать boost, по клавише t — rotate

    if key == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
