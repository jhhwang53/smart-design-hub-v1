import 'dotenv/config';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

/**
 * Cafe24 웹 FTP(SFTP)로 업로드하는 예시 스크립트
 * - GitLab CI에서 .env 또는 환경변수로 다음 값들을 사용:
 *   - process.env.FTP_HOST
 *   - process.env.FTP_PORT (기본 3822)
 *   - process.env.FTP_USERNAME
 *   - process.env.FTP_PASSWORD
 *   - process.env.FTP_BASE_DIR (업로드할 Cafe24 디렉토리)
 *   - process.env.SKIN_DIR (스킨 디렉토리, 기본값: base)
 * - lftp 사용, SFTP 프로토콜 사용
 */

async function deploy() {
  try {
    // 스킨 디렉토리 설정 (기본값: base)
    const skinDir = process.env.SKIN_DIR || 'base';

    console.log('----------------------------------------');
    console.log('SFTP 서버에 연결 시도 중...');
    console.log(`호스트: ${process.env.FTP_HOST}`);
    console.log(`사용자: ${process.env.FTP_USERNAME}`);
    console.log(`기본 디렉토리: ${process.env.FTP_BASE_DIR}`);
    console.log(`스킨 디렉토리: ${skinDir}`);
    console.log('----------------------------------------');

    // 1) SFTP 접속 테스트 스크립트 작성
    const testScriptPath = path.join(process.cwd(), 'sftp_test.txt');
    const ftpTestCommands = `
set net:timeout 120
set net:max-retries 5
# 호스트키 자동 수락 (보안상 주의 필요)
set sftp:auto-confirm yes
# 재연결 설정
set net:reconnect-interval-base 5
set net:reconnect-interval-multiplier 1

open sftp://${process.env.FTP_USERNAME}:${process.env.FTP_PASSWORD}@${process.env.FTP_HOST}:${process.env.FTP_PORT}
pwd
bye
    `.trim();

    fs.writeFileSync(testScriptPath, ftpTestCommands);

    // 2) 접속 테스트
    try {
      const result = execSync(`lftp -f ${testScriptPath}`, { encoding: 'utf8' });
      console.log('✅ SFTP 서버 연결 성공!');
      console.log('현재 경로:', result.trim());
    } catch (err) {
      console.error('❌ SFTP 연결 실패!', err.message);
      throw new Error('SFTP 연결에 실패했습니다.');
    } finally {
      fs.unlinkSync(testScriptPath);
    }

    console.log('----------------------------------------');

    // 3) 업로드할 파일 목록 (예: public/base/test.html)
    // 필요 시 glob 패턴으로 다른 파일도 매칭 가능
    const files = await glob(`public/${skinDir}/**/*.{html,css,js,jpg,jpeg,png,gif,svg,webp}`, {
      nodir: true,
    });

    console.log(`업로드할 파일 ${files.length}개 찾음`);
    console.log(`파일 목록:`, files);

    if (files.length === 0) {
      console.log('업로드할 파일이 없습니다. 작업을 중단합니다.');
      return;
    }

    // 4) 업로드 명령어 스크립트 생성
    const uploadScriptPath = path.join(process.cwd(), 'sftp_upload.txt');
    let uploadCommands = `
set net:timeout 300
set net:max-retries 10
set sftp:auto-confirm yes
set net:reconnect-interval-base 5
set net:reconnect-interval-multiplier 1
set net:persist-retries 10

open sftp://${process.env.FTP_USERNAME}:${process.env.FTP_PASSWORD}@${process.env.FTP_HOST}:${process.env.FTP_PORT}
cd ${process.env.FTP_BASE_DIR}/${skinDir}
ls
    `.trimStart();

    // 각 파일을 put 명령어로 업로드
    for (const file of files) {
      const filePath = path.resolve(process.cwd(), file);
      // public/스킨명/ 이후의 상대 경로 추출
      const relativePath = file.replace(`public/${skinDir}/`, '');
      const targetDir = path.dirname(relativePath);

      // 타겟 디렉토리가 있는지 확인하고 없으면 생성
      if (targetDir !== '.') {
        uploadCommands += `
mkdir -p "${targetDir}"
cd "${targetDir}"
        `.trimStart();
      }

      uploadCommands += `
put "${filePath}" -o "${path.basename(file)}"
      `.trimStart();

      // 원래 디렉토리로 돌아가기
      if (targetDir !== '.') {
        uploadCommands += `
cd ${process.env.FTP_BASE_DIR}/${skinDir}
        `.trimStart();
      }
    }

    // 마지막에 bye
    uploadCommands += `
bye
    `;

    fs.writeFileSync(uploadScriptPath, uploadCommands);

    // 5) 실제 업로드
    try {
      execSync(`lftp -f ${uploadScriptPath}`, { stdio: 'inherit' });
      console.log('✅ 파일 업로드 성공!');
    } catch (err) {
      console.error('❌ 파일 업로드 실패:', err.message);
      throw err;
    } finally {
      fs.unlinkSync(uploadScriptPath);
    }

    console.log('----------------------------------------');
    console.log('✨ 모든 파일 업로드 완료!');
  } catch (err) {
    console.error('❌ 배포 실패:', err);
    process.exit(1);
  }
}

deploy();
