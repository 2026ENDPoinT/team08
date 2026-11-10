#include "mainwindow.h"
#include "ui_mainwindow.h"
#include <QMessageBox>
#include <QTableWidgetItem>
#include <QPushButton>
#include <QTableWidget>
#include <QLabel>
#include <QAbstractItemView>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QJsonParseError>
#include <QStandardPaths>
#include <QDir>
#include <QSaveFile>

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
{
    ui->setupUi(this);

    connect(ui->addCourseButton, &QPushButton::clicked,
            this, [this]() {

                // 1. 과목명 입력받기
                QString name = ui->courseNameEdit->text().trimmed();

                // 2. 학점 입력받기
                int credit = ui->creditSpinBox->value();

                // 3. 성적 입력받기
                QString grade = ui->gradeComboBox->currentText();

                // 4. 과목명이 비어 있는지 확인
                if (name.isEmpty()) {
                    QMessageBox::warning(this, "입력 오류",
                                         "과목명을 입력하세요.");
                    return;
                }

                // 5. 표에 새로운 행 추가
                int row = ui->courseTable->rowCount();
                ui->courseTable->insertRow(row);

                // 6. 행에 데이터 입력
                ui->courseTable->setItem(
                    row, 0, new QTableWidgetItem(name));

                ui->courseTable->setItem(
                    row, 1, new QTableWidgetItem(QString::number(credit)));

                ui->courseTable->setItem(
                    row, 2, new QTableWidgetItem(grade));

                // 7. 과목명 입력창 초기화
                ui->courseNameEdit->clear();
                updateGPA();
                // 파일에 자동 저장
                saveCourses();
            });
    // 과목 삭제 버튼 클릭 이벤트
    connect(ui->deleteCourseButton, &QPushButton::clicked,
            this, [this]() {

                // 현재 선택된 행 번호 가져오기
                int row = ui->courseTable->currentRow();

                // 아무 과목도 선택하지 않았을 경우
                if (row < 0) {
                    QMessageBox::warning(
                        this,
                        "선택 오류",
                        "삭제할 과목을 선택하세요."
                        );
                    return;
                }

                // 삭제 여부 확인
                auto result = QMessageBox::question(
                    this,
                    "과목 삭제",
                    "선택한 과목을 삭제하시겠습니까?",
                    QMessageBox::Yes | QMessageBox::No
                    );

                if (result == QMessageBox::No) {
                    return;
                }

                // 선택된 과목 삭제
                ui->courseTable->removeRow(row);

                // 선택 삭제 상태 초기화
                ui->courseTable->clearSelection();

                // 현재 선택된 셀 초기화
                ui->courseTable->setCurrentCell(-1, -1);

                // GPA 다시 계산
                updateGPA();

                // 변경된 과목 목록 저장
                saveCourses();
            });
    // 프로그램 시작시 저장된 과목 불러오기
    loadCourses();
}

MainWindow::~MainWindow()
{
    delete ui;
}

void MainWindow::updateGPA()
{
    double totalPoints = 0.0;
    int totalCredits = 0;

    for (int i = 0; i < ui->courseTable->rowCount(); ++i) {
        int credit = ui->courseTable->item(i, 1)->text().toInt();
        QString grade = ui->courseTable->item(i, 2)->text();

        double point = 0.0;

        if (grade == "A+") point = 4.5;
        else if (grade == "A0") point = 4.0;
        else if (grade == "B+") point = 3.5;
        else if (grade == "B0") point = 3.0;
        else if (grade == "C+") point = 2.5;
        else if (grade == "C0") point = 2.0;
        else if (grade == "D+") point = 1.5;
        else if (grade == "D0") point = 1.0;

        totalPoints += point * credit;
        totalCredits += credit;
    }

    double gpa = 0.0;

    if (totalCredits > 0) {
        gpa = totalPoints / totalCredits;
    }

    ui->gpaLabel->setText(
        QString("평균평점: %1 / 4.50")
            .arg(gpa, 0, 'f', 2)
        );
}
void MainWindow::saveCourses()
{
    // 1. 모든 과목을 저장할 JSON 배열
    QJsonArray courses;

    // 2. 표의 모든 행을 순회
    for (int i = 0; i < ui->courseTable->rowCount(); ++i) {

        QJsonObject course;

        // 과목명
        course["name"] =
            ui->courseTable->item(i, 0)->text();

        // 이수학점
        course["credit"] =
            ui->courseTable->item(i, 1)->text().toInt();

        // 성적
        course["grade"] =
            ui->courseTable->item(i, 2)->text();

        // 배열에 과목 추가
        courses.append(course);
    }

    // 3. 최상위 JSON 객체 생성
    QJsonObject root;
    root["courses"] = courses;

    QJsonDocument document(root);

    // 4. 저장 폴더 설정
    QString directory =
        QStandardPaths::writableLocation(
            QStandardPaths::AppDataLocation
            );

    QDir().mkpath(directory);

    QString filePath = directory + "/courses.json";

    // 5. 안전한 파일 저장
    QSaveFile file(filePath);

    if (!file.open(QIODevice::WriteOnly)) {
        QMessageBox::warning(
            this,
            "저장 오류",
            "파일을 저장할 수 없습니다."
            );
        return;
    }

    QByteArray data = document.toJson();

    if (file.write(data) != data.size() ||
        !file.commit()) {
        QMessageBox::warning(
            this,
            "저장 오류",
            "데이터 저장에 실패했습니다."
            );
    }
}

void MainWindow::loadCourses()
{
    // 1. 저장 파일 경로 가져오기
    QString directory =
        QStandardPaths::writableLocation(
            QStandardPaths::AppDataLocation
            );

    QString filePath = directory + "/courses.json";

    QFile file(filePath);

    // 2. 저장 파일이 없으면 종료
    if (!file.exists()) {
        return;
    }

    // 3. 파일 열기
    if (!file.open(QIODevice::ReadOnly)) {
        QMessageBox::warning(
            this,
            "불러오기 오류",
            "저장 파일을 열 수 없습니다."
            );
        return;
    }

    // 4. JSON 데이터 읽기
    QByteArray data = file.readAll();
    file.close();

    QJsonParseError error;

    QJsonDocument document =
        QJsonDocument::fromJson(data, &error);

    if (error.error != QJsonParseError::NoError ||
        !document.isObject()) {
        QMessageBox::warning(
            this,
            "불러오기 오류",
            "JSON 파일 형식이 올바르지 않습니다."
            );
        return;
    }

    QJsonObject root = document.object();

    if (!root.value("courses").isArray()) {
        QMessageBox::warning(
            this,
            "불러오기 오류",
            "과목 데이터 형식이 올바르지 않습니다."
            );
        return;
    }

    QJsonArray courses = root["courses"].toArray();

    // 5. 기존 표 초기화
    ui->courseTable->setRowCount(0);

    // 6. 각 과목을 표에 복원
    for (const QJsonValue &value : courses) {

        if (!value.isObject()) {
            continue;
        }

        QJsonObject course = value.toObject();

        QString name = course["name"].toString();
        int credit = course["credit"].toInt();
        QString grade = course["grade"].toString();

        int row = ui->courseTable->rowCount();

        ui->courseTable->insertRow(row);

        ui->courseTable->setItem(
            row, 0, new QTableWidgetItem(name)
            );

        ui->courseTable->setItem(
            row, 1,
            new QTableWidgetItem(QString::number(credit))
            );

        ui->courseTable->setItem(
            row, 2, new QTableWidgetItem(grade)
            );
    }

    // 7. 선택 상태 및 GPA 초기화
    ui->courseTable->clearSelection();
    ui->courseTable->setCurrentCell(-1, -1);

    updateGPA();
}

